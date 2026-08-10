import { execFileSync, spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const DEFAULT_SINK_PORT = 54329;
const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const args = process.argv.slice(2);
const readArgument = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const sourceEnvPath = readArgument("--source-env");
const readyFilePath = readArgument("--ready-file");
const sinkPort = Number(readArgument("--sink-port") ?? DEFAULT_SINK_PORT);

if (!sourceEnvPath) {
  throw new Error("Pass --source-env with a local, gitignored Bloomjoy env file.");
}

if (!Number.isSafeInteger(sinkPort) || sinkPort < 1024 || sinkPort > 65535) {
  throw new Error("--sink-port must be an unused local port between 1024 and 65535.");
}

if (readyFilePath) {
  const relativeReadyPath = relative(resolve(tmpdir()), resolve(readyFilePath));
  if (
    !relativeReadyPath ||
    relativeReadyPath.startsWith("..") ||
    isAbsolute(relativeReadyPath)
  ) {
    throw new Error("--ready-file must be a new file inside the operating-system temp directory.");
  }
  if (existsSync(readyFilePath)) {
    throw new Error("--ready-file already exists; choose a new temporary path.");
  }
}

const readDedicatedStripeTestKey = async (path) => {
  let stripeTestKey = "";
  let unexpectedAssignmentCount = 0;
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      throw new Error("The sandbox key file contains an invalid assignment.");
    }

    if (match[1] !== "STRIPE_SECRET_KEY_TEST") {
      unexpectedAssignmentCount += 1;
      continue;
    }

    if (stripeTestKey) {
      throw new Error("The sandbox key file defines STRIPE_SECRET_KEY_TEST more than once.");
    }
    stripeTestKey = match[2].trim().replace(/^['"]|['"]$/g, "");
  }

  if (unexpectedAssignmentCount) {
    throw new Error(
      "Use a dedicated sandbox-only env file containing only STRIPE_SECRET_KEY_TEST.",
    );
  }

  return stripeTestKey;
};

const stripeTestKey = await readDedicatedStripeTestKey(sourceEnvPath);
if (!stripeTestKey.startsWith("sk_test_")) {
  throw new Error("The source env does not contain a validated STRIPE_SECRET_KEY_TEST.");
}

const redact = (value) => String(value)
  .replace(/sk_(?:test|live)_[A-Za-z0-9_]+/g, "sk_redacted")
  .replace(/whsec_[A-Za-z0-9_]+/g, "whsec_redacted");

const SAFE_CHILD_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

const childBaseEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    SAFE_CHILD_ENVIRONMENT_KEYS.has(key.toUpperCase())
  ),
);

const childProcesses = [];
let sinkServer = null;
let tempDirectory = null;
let readyFileCreated = false;
let cleanupPromise = null;

const waitForExit = (child, timeoutMs) => new Promise((resolveExit) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolveExit(true);
    return;
  }

  const timeout = setTimeout(() => {
    child.removeListener("exit", onExit);
    resolveExit(false);
  }, timeoutMs);
  const onExit = () => {
    clearTimeout(timeout);
    resolveExit(true);
  };
  child.once("exit", onExit);
});

const runTaskkill = (pid, force) => new Promise((resolveKill) => {
  const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
  const killer = spawn("taskkill.exe", args, {
    env: childBaseEnvironment,
    stdio: "ignore",
    windowsHide: true,
  });
  killer.once("error", () => resolveKill());
  killer.once("exit", () => resolveKill());
});

const terminateProcessTree = async (child) => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    await runTaskkill(child.pid, false);
    if (!(await waitForExit(child, 5000))) {
      await runTaskkill(child.pid, true);
      await waitForExit(child, 5000);
    }
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  if (!(await waitForExit(child, 5000))) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The process group already exited.
    }
    await waitForExit(child, 5000);
  }
};

const cleanup = () => {
  cleanupPromise ??= (async () => {
    await Promise.all(childProcesses.map(terminateProcessTree));

    if (sinkServer?.listening) {
      await new Promise((resolveClose) => {
        sinkServer.close(resolveClose);
        sinkServer.closeAllConnections?.();
      });
    }

    if (tempDirectory) {
      const expectedPrefix = resolve(join(tmpdir(), "bloomjoy-payment-uat-"));
      const resolvedTempDirectory = resolve(tempDirectory);
      if (!resolvedTempDirectory.startsWith(expectedPrefix)) {
        throw new Error("Refusing to remove an unexpected UAT temp directory.");
      }
      rmSync(resolvedTempDirectory, { recursive: true, force: true });
    }

    if (readyFileCreated && readyFilePath) {
      rmSync(readyFilePath, { force: true });
    }
  })();
  return cleanupPromise;
};

let exitStarted = false;
const exitAfterCleanup = (exitCode, error = null) => {
  if (exitStarted) return;
  exitStarted = true;
  if (error) {
    console.error(redact(error instanceof Error ? error.message : error));
  }
  cleanup()
    .then(() => process.exit(exitCode))
    .catch((cleanupError) => {
      console.error(redact(cleanupError));
      process.exit(1);
    });
};

process.once("SIGINT", () => exitAfterCleanup(0));
process.once("SIGTERM", () => exitAfterCleanup(0));
process.once("uncaughtException", (error) => exitAfterCleanup(1, error));
process.once("unhandledRejection", (error) => exitAfterCleanup(1, error));

const localStatus = JSON.parse(execFileSync("supabase.exe", ["status", "-o", "json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...childBaseEnvironment, RESEND_API_KEY: "local-not-used" },
  stdio: ["ignore", "pipe", "ignore"],
}));

for (const urlValue of [localStatus.API_URL, localStatus.FUNCTIONS_URL, localStatus.DB_URL]) {
  const url = new URL(urlValue);
  if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
    throw new Error("Supabase UAT must target the worktree-local stack.");
  }
}
const localFunctionsUrl = String(localStatus.FUNCTIONS_URL).replace(/\/$/, "");

const stripeRequest = async (path) => {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${stripeTestKey}` },
  });
  if (!response.ok) {
    throw new Error(`Stripe test API request failed (${response.status}).`);
  }
  return response.json();
};

const priceResponse = await stripeRequest(
  "/v1/prices?active=true&limit=100&expand%5B%5D=data.product",
);

const activePrices = priceResponse.data ?? [];
const productName = (price) => String(price.product?.name ?? "");
const isApprovedTestPrice = (price) =>
  price.active === true &&
  price.livemode === false &&
  price.currency === "usd" &&
  price.product?.active === true;
const isApprovedOneTimePrice = (price) =>
  isApprovedTestPrice(price) && price.type === "one_time";
const uniquePrice = (label, predicate) => {
  const matches = activePrices.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label} must resolve to exactly one active Stripe test Price.`);
  }
  return matches[0].id;
};

const prices = {
  sugarMember: uniquePrice(
    "member sugar",
    (price) => isApprovedOneTimePrice(price) &&
      price.unit_amount === 800 && productName(price) === "Sugar 1KG",
  ),
  sugarStandard: uniquePrice(
    "standard sugar",
    (price) => isApprovedOneTimePrice(price) &&
      price.unit_amount === 1000 &&
      productName(price).includes("Premium Cotton Candy Sugar") &&
      productName(price).includes("Standard"),
  ),
  sticksMember: uniquePrice(
    "member sticks",
    (price) => isApprovedOneTimePrice(price) &&
      price.unit_amount === 10400 &&
      productName(price).includes("Branded Paper Sticks") &&
      productName(price).includes("Plus Member"),
  ),
  sticksStandard: uniquePrice(
    "standard sticks",
    (price) => isApprovedOneTimePrice(price) &&
      price.unit_amount === 13000 &&
      productName(price).includes("Branded Paper Sticks") &&
      productName(price).includes("Standard"),
  ),
  plus: uniquePrice(
    "Bloomjoy Plus",
    (price) => isApprovedTestPrice(price) &&
      price.unit_amount === 10000 &&
      price.type === "recurring" &&
      price.recurring?.interval === "month" &&
      price.recurring?.interval_count === 1 &&
      productName(price) === "Bloomjoy Plus",
  ),
};

const sinkToken = randomBytes(18).toString("hex");
const emailEvents = [];
let failNextEmailCount = 0;
let shutdownRequested = false;

const sendJson = (response, status, payload) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const handleSinkRequest = async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${sinkPort}`);
  const prefix = `/${sinkToken}`;
  if (!url.pathname.startsWith(prefix)) {
    return sendJson(response, 404, { error: "not found" });
  }

  if (request.method === "GET" && url.pathname === `${prefix}/health`) {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === `${prefix}/events`) {
    const internal = emailEvents.filter((event) => event.kind === "internal");
    const customer = emailEvents.filter((event) => event.kind === "customer");
    return sendJson(response, 200, {
      emailCalls: emailEvents.length,
      internalEmailCalls: internal.length,
      customerEmailCalls: customer.length,
      uniqueIdempotencyKeys: new Set(emailEvents.map((event) => event.idempotencyKey)).size,
      failedCalls: emailEvents.filter((event) => event.failed).length,
      events: emailEvents.map(({ kind, idempotencyKey, recipientCount, failed }) => ({
        kind,
        idempotencyKeyPresent: Boolean(idempotencyKey),
        recipientCount,
        failed,
      })),
    });
  }

  if (request.method === "POST" && url.pathname === `${prefix}/reset`) {
    emailEvents.length = 0;
    failNextEmailCount = 0;
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === `${prefix}/fail-next-email`) {
    failNextEmailCount += 1;
    return sendJson(response, 200, { ok: true, queuedFailures: failNextEmailCount });
  }

  if (request.method === "POST" && url.pathname === `${prefix}/shutdown`) {
    shutdownRequested = true;
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === `${prefix}/resend/emails`) {
    const payload = await readJsonBody(request);
    const recipients = Array.isArray(payload.to) ? payload.to : [];
    const kind = recipients.some((value) =>
      String(value).toLowerCase().endsWith("@bloomjoysweets.com")
    ) ? "internal" : "customer";
    const failed = failNextEmailCount > 0;
    if (failed) failNextEmailCount -= 1;
    emailEvents.push({
      kind,
      idempotencyKey: String(request.headers["idempotency-key"] ?? ""),
      recipientCount: recipients.length,
      failed,
    });
    return sendJson(response, failed ? 503 : 200, failed
      ? { error: "synthetic local failure" }
      : { id: `local_email_${emailEvents.length}` });
  }

  return sendJson(response, 404, { error: "not found" });
};

sinkServer = createServer((request, response) => {
  handleSinkRequest(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 400, { error: "invalid local sink request" });
      return;
    }
    response.destroy();
  });
});

await new Promise((resolve, reject) => {
  sinkServer.once("error", reject);
  sinkServer.listen(sinkPort, "0.0.0.0", resolve);
});

const spawnManaged = (command, commandArgs, options = {}) => {
  const child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: childBaseEnvironment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  childProcesses.push(child);
  return child;
};

const stripeListener = spawnManaged("stripe.exe", [
  "listen",
  "--forward-to",
  `${localFunctionsUrl}/stripe-webhook`,
  "--events",
  STRIPE_EVENTS.join(","),
], {
  env: { ...childBaseEnvironment, STRIPE_API_KEY: stripeTestKey },
});

const webhookSecret = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Stripe listener did not become ready.")), 30000);
  const inspect = (chunk) => {
    const text = chunk.toString("utf8");
    const match = text.match(/whsec_[A-Za-z0-9_]+/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[0]);
    }
  };
  stripeListener.stdout.on("data", inspect);
  stripeListener.stderr.on("data", inspect);
  stripeListener.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Stripe listener exited before readiness (${code}).`));
  });
  stripeListener.once("error", reject);
});

tempDirectory = mkdtempSync(join(tmpdir(), "bloomjoy-payment-uat-"));
const functionEnvPath = join(tempDirectory, "functions.env");
const functionEnv = [
  `STRIPE_SECRET_KEY=${stripeTestKey}`,
  `STRIPE_WEBHOOK_SECRET=${webhookSecret}`,
  `STRIPE_SUGAR_PRICE_ID=${prices.sugarMember}`,
  `STRIPE_SUGAR_MEMBER_PRICE_ID=${prices.sugarMember}`,
  `STRIPE_SUGAR_NON_MEMBER_PRICE_ID=${prices.sugarStandard}`,
  `STRIPE_STICKS_PRICE_ID=${prices.sticksStandard}`,
  `STRIPE_STICKS_MEMBER_PRICE_ID=${prices.sticksMember}`,
  `STRIPE_PLUS_PRICE_ID=${prices.plus}`,
  "MICRO_CHECKOUT_ENABLED=false",
  "BLOOMJOY_ALLOW_LOCAL_REDIRECT_URLS=true",
  "BLOOMJOY_ENABLE_LOCAL_NOTIFICATION_SINK=true",
  `BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL=http://host.docker.internal:${sinkPort}/${sinkToken}`,
  "INTERNAL_NOTIFICATION_FROM_EMAIL=uat@bloomjoy.localhost",
  "INTERNAL_NOTIFICATION_RECIPIENTS=",
  "WECOM_CORP_ID=",
  "WECOM_AGENT_ID=",
  "WECOM_AGENT_SECRET=",
  "WECOM_ALERT_TO_USERIDS=",
].join("\n");
writeFileSync(functionEnvPath, `${functionEnv}\n`, { encoding: "utf8", mode: 0o600 });

const functionServer = spawnManaged("supabase.exe", [
  "functions",
  "serve",
  "--env-file",
  functionEnvPath,
  "--no-verify-jwt",
], {
  env: { ...childBaseEnvironment, RESEND_API_KEY: "local-not-used" },
});

let functionLog = "";
for (const stream of [functionServer.stdout, functionServer.stderr]) {
  stream.on("data", (chunk) => {
    functionLog = `${functionLog}${redact(chunk)}`.slice(-8000);
  });
}

const waitForFunctionConfiguration = async () => {
  const deadline = Date.now() + 120000;
  const body = JSON.stringify({
    items: [],
    successUrl: "http://127.0.0.1:8081/cart?checkout=success",
    cancelUrl: "http://127.0.0.1:8081/cart?checkout=cancel",
  });
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${localFunctionsUrl}/stripe-sugar-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const payload = await response.json();
      if (response.status === 400 && payload.error === "Cart is empty.") return;
    } catch {
      // Keep polling while the local Edge runtime restarts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local functions did not load the UAT configuration. ${functionLog}`);
};

await waitForFunctionConfiguration();

const readyPayload = {
  ready: true,
  functionsUrl: localFunctionsUrl,
  sinkEventsUrl: `http://127.0.0.1:${sinkPort}/${sinkToken}/events`,
  sinkFailNextUrl: `http://127.0.0.1:${sinkPort}/${sinkToken}/fail-next-email`,
  sinkResetUrl: `http://127.0.0.1:${sinkPort}/${sinkToken}/reset`,
  sinkShutdownUrl: `http://127.0.0.1:${sinkPort}/${sinkToken}/shutdown`,
  stripeMode: "test",
  microEnabled: false,
};

if (readyFilePath) {
  writeFileSync(readyFilePath, `${JSON.stringify(readyPayload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  readyFileCreated = true;
}
console.log(JSON.stringify(readyPayload));

const shutdownWatcher = setInterval(() => {
  if (!shutdownRequested) return;
  clearInterval(shutdownWatcher);
  exitAfterCleanup(0);
}, 100);

await new Promise(() => {});

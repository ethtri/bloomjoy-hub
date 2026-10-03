import {
  buildMachineEmail,
  machineEmailCategories,
  type MachineEmailLinks,
  parseMachineEmailProjection,
} from "./machine-email-alert.ts";
import {
  type AlertRpcClient,
  type AlertSendEmail,
  deliverMachineEmailClaim,
  deliverMachineReadyClaim,
} from "./machine-email-alert-delivery.ts";

type DispatchDependencies = {
  client: AlertRpcClient;
  secret: string | undefined;
  transportConfigured: boolean;
  sendEmail: AlertSendEmail;
  links: MachineEmailLinks;
  collectSignals: (observedAt: string) => Promise<unknown>;
  now?: () => Date;
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isSnapshotTime = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
    .test(value) &&
  Number.isFinite(Date.parse(value));
type PreviewCursor = {
  observedAt: string;
  userId: string;
  category: string;
  slotKey: string;
};
const isPreviewCursor = (value: unknown): value is PreviewCursor =>
  isRecord(value) &&
  Object.keys(value).sort().join("|") ===
    "category|observedAt|slotKey|userId" &&
  isSnapshotTime(value.observedAt) && typeof value.userId === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    .test(value.userId) &&
  machineEmailCategories.some((category) => category === value.category) &&
  typeof value.slotKey === "string" &&
  /^[A-Za-z0-9_:-]{1,200}$/.test(value.slotKey);
const cursorOrder = (cursor: PreviewCursor) =>
  `${cursor.userId}|${cursor.category}|${cursor.slotKey}`;
function sameSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function createMachineEmailDispatcher(
  deps: DispatchDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (
      !deps.secret ||
      !sameSecret(
        request.headers.get("Authorization") ?? "",
        `Bearer ${deps.secret}`,
      )
    ) return json({ error: "unauthorized" }, 401);
    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return json({ error: "request_too_large" }, 413);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (
      !isRecord(body) ||
      Object.keys(body).some((key) =>
        !["dryRun", "observeOnly", "previewCursor", "previewObservedAt"]
          .includes(key)
      ) || (body.dryRun !== undefined && typeof body.dryRun !== "boolean") ||
      (body.observeOnly !== undefined &&
        typeof body.observeOnly !== "boolean") ||
      (body.dryRun === true && body.observeOnly === true) ||
      ((body.previewCursor !== undefined ||
        body.previewObservedAt !== undefined) && body.dryRun !== true) ||
      (body.previewCursor !== undefined && body.previewCursor !== null &&
        !isPreviewCursor(body.previewCursor)) ||
      (body.previewObservedAt !== undefined &&
        !isSnapshotTime(body.previewObservedAt))
    ) return json({ error: "invalid_request" }, 400);
    const observedAt = (deps.now?.() ?? new Date()).toISOString();
    if (body.dryRun === true) {
      const cursor = body.previewCursor as PreviewCursor | null | undefined;
      const snapshot = cursor?.observedAt ??
        (body.previewObservedAt as string | undefined) ?? observedAt;
      if (
        cursor && body.previewObservedAt !== undefined &&
        Date.parse(cursor.observedAt) !==
          Date.parse(body.previewObservedAt as string)
      ) {
        return json({ error: "preview_snapshot_mismatch" }, 400);
      }
      // Intentionally isolated from every claim/reservation, signal write and provider read/send.
      const preview = await deps.client.rpc("service_preview_email_alerts", {
        p_observed_at: snapshot,
        p_limit: 1,
        p_cursor: cursor ?? null,
      });
      if (
        preview.error || !isRecord(preview.data) ||
        !Array.isArray(preview.data.projections) ||
        !isSnapshotTime(preview.data.observedAt) ||
        Date.parse(preview.data.observedAt) !== Date.parse(snapshot) ||
        typeof preview.data.hasMore !== "boolean" ||
        typeof preview.data.complete !== "boolean" ||
        preview.data.complete === preview.data.hasMore ||
        !Number.isSafeInteger(preview.data.pageCount) ||
        preview.data.pageCount !== preview.data.projections.length ||
        preview.data.projections.length > 1 ||
        !Number.isSafeInteger(preview.data.totalCandidates) ||
        (preview.data.totalCandidates as number) <
          preview.data.projections.length ||
        (preview.data.hasMore &&
          (preview.data.totalCandidates as number) <=
            preview.data.projections.length) ||
        (!cursor && preview.data.complete === true &&
          preview.data.totalCandidates !== preview.data.projections.length) ||
        (preview.data.hasMore
          ? !isPreviewCursor(preview.data.nextCursor) ||
            preview.data.projections.length === 0 ||
            Date.parse(preview.data.nextCursor.observedAt) !==
              Date.parse(snapshot) ||
            (cursor &&
              cursorOrder(preview.data.nextCursor) <= cursorOrder(cursor))
          : preview.data.nextCursor !== null)
      ) {
        return json({
          status: "validation_failed",
          error: "preview_unavailable",
          writesApplied: 0,
          providerCalls: 0,
        }, 503);
      }
      let invalid = 0;
      const validationErrors: Record<string, number> = {};
      let largestHtmlBytes = 0;
      let largestTextBytes = 0;
      const categories: Record<string, number> = {};
      for (const value of preview.data.projections) {
        try {
          const projection = parseMachineEmailProjection(value);
          if (Date.parse(projection.observedAt) !== Date.parse(snapshot)) {
            throw new Error("email_alert_preview_snapshot_invalid");
          }
          const rendered = buildMachineEmail({ projection, links: deps.links });
          categories[projection.category] =
            (categories[projection.category] ?? 0) + 1;
          largestHtmlBytes = Math.max(
            largestHtmlBytes,
            new TextEncoder().encode(rendered.html).length,
          );
          largestTextBytes = Math.max(
            largestTextBytes,
            new TextEncoder().encode(rendered.text).length,
          );
        } catch (error) {
          invalid++;
          const code = error instanceof Error &&
              /^email_alert_[a-z_]+$/.test(error.message)
            ? error.message
            : "projection_invalid";
          validationErrors[code] = (validationErrors[code] ?? 0) + 1;
        }
      }
      return json({
        status: invalid
          ? "validation_failed"
          : !cursor && preview.data.complete
          ? "validated"
          : "page_validated",
        dryRun: true,
        observedAt: preview.data.observedAt,
        hasMore: preview.data.hasMore,
        nextCursor: preview.data.nextCursor,
        pageCount: preview.data.pageCount,
        totalCandidates: preview.data.totalCandidates,
        complete: preview.data.complete,
        validationScope: !cursor && preview.data.complete
          ? "all_due_candidates"
          : "current_page",
        deliveryEnabled: preview.data.deliveryEnabled === true,
        projectionCount: preview.data.projections.length,
        invalidProjectionCount: invalid,
        validationErrors,
        categories,
        largestHtmlBytes,
        largestTextBytes,
        writesApplied: 0,
        providerCalls: 0,
      }, invalid ? 422 : 200);
    }
    if (body.observeOnly !== true) {
      const activation = await deps.client.rpc(
        "service_email_alert_delivery_status",
        {},
      );
      if (activation.error || !isRecord(activation.data)) {
        return json({
          error: "delivery_status_unavailable",
          writesApplied: 0,
          providerCalls: 0,
        }, 503);
      }
      if (activation.data.deliveryEnabled !== true) {
        return json({
          status: "disabled",
          writesApplied: 0,
          providerCalls: 0,
          emailsSent: 0,
          claimsReserved: 0,
        });
      }
      if (!deps.transportConfigured) {
        return json({
          error: "transport_not_configured",
          writesApplied: 0,
          providerCalls: 0,
        }, 503);
      }
    }
    let signals: unknown = null;
    let signalStatus = "collected";
    try {
      signals = await deps.collectSignals(observedAt);
    } catch {
      signalStatus = "unavailable";
    }
    if (body.observeOnly === true) {
      return json({
        status: signalStatus === "collected" ? "observed" : "attention",
        observeOnly: true,
        emailsSent: 0,
        claimsReserved: 0,
        signalStatus,
        signals,
      });
    }
    const counts = { sent: 0, stale: 0, held: 0 };
    const ready = { sent: 0, stale: 0, held: 0, status: "completed" };
    const deadline = Date.now() + 35_000;
    // The existing ledger is shared with the refund sweep, so either scheduler can
    // deliver an opted-in decision exactly once. SQL enforces activation and current preferences.
    const enqueued = await deps.client.rpc(
      "service_enqueue_refund_manager_ready_notices",
      { p_refund_case_id: null, p_observed_at: observedAt },
    );
    if (enqueued.error) ready.status = "unavailable";
    else {for (let i = 0; i < 25 && Date.now() < deadline; i++) {
        const claim = await deps.client.rpc(
          "service_claim_next_refund_manager_ready_notice",
          {
            p_refund_case_id: null,
            p_observed_at: (deps.now?.() ?? new Date()).toISOString(),
          },
        );
        if (claim.error || !isRecord(claim.data)) {
          ready.status = "unavailable";
          break;
        }
        if (claim.data.claimed !== true) break;
        try {
          ready[
            await deliverMachineReadyClaim({
              client: deps.client,
              claim: claim.data,
              sendEmail: deps.sendEmail,
              links: deps.links,
            })
          ]++;
        } catch {
          ready.held++;
        }
      }}
    // This is an execution budget, not a recipient/content cap. Remaining work stays durable for the next tick.
    for (let i = 0; i < 100 && Date.now() < deadline; i++) {
      const claim = await deps.client.rpc("service_claim_next_email_alert", {
        p_observed_at: (deps.now?.() ?? new Date()).toISOString(),
      });
      if (claim.error || !isRecord(claim.data)) {
        return json({
          status: "attention",
          error: "claim_unavailable",
          ...counts,
          ready,
          signalStatus,
          signals,
        }, 503);
      }
      if (claim.data.claimed !== true) break;
      try {
        counts[
          await deliverMachineEmailClaim({
            client: deps.client,
            claim: claim.data,
            sendEmail: deps.sendEmail,
            links: deps.links,
          })
        ]++;
      } catch {
        counts.held++;
      }
    }
    return json({
      status: counts.held || ready.held || ready.status !== "completed"
        ? "attention"
        : "completed",
      ...counts,
      ready,
      signalStatus,
      signals,
    });
  };
}

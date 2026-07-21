import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateDefinitions = [
  {
    type: 'invite',
    file: 'supabase/templates/invite.html',
    subject: 'Your Bloomjoy Hub invitation code',
    contentKey: 'mailer_templates_invite_content',
    subjectKey: 'mailer_subjects_invite',
    stableDestination: '.SiteURL',
  },
  {
    type: 'magic link',
    file: 'supabase/templates/magic-link.html',
    subject: 'Your Bloomjoy Hub sign-in code',
    contentKey: 'mailer_templates_magic_link_content',
    subjectKey: 'mailer_subjects_magic_link',
    stableDestination: '.RedirectTo',
  },
  {
    type: 'recovery',
    file: 'supabase/templates/recovery.html',
    subject: 'Your Bloomjoy Hub password recovery code',
    contentKey: 'mailer_templates_recovery_content',
    subjectKey: 'mailer_subjects_recovery',
    stableDestination: '.RedirectTo',
  },
];

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const loadedTemplates = await Promise.all(
  templateDefinitions.map(async (definition) => ({
    ...definition,
    content: await readFile(path.join(repoRoot, definition.file), 'utf8'),
  }))
);

for (const template of loadedTemplates) {
  assert(template.content.includes('{{ .Token }}'), `${template.file} must show the manual OTP.`);
  assert(
    template.content.includes(`{{ ${template.stableDestination} }}`),
    `${template.file} must link only to its stable Bloomjoy destination.`
  );
  assert(
    !template.content.includes('.ConfirmationURL'),
    `${template.file} must not contain the scanner-consumable ConfirmationURL.`
  );
  assert(
    !template.content.includes('.TokenHash'),
    `${template.file} must not contain a token hash.`
  );

  const rendered = template.content
    .replaceAll('{{ .Token }}', '123456')
    .replaceAll('{{ .SiteURL }}', 'https://app.bloomjoyusa.com')
    .replaceAll('{{ .RedirectTo }}', 'https://app.bloomjoyusa.com/login?intent=technician');
  const hrefs = [...rendered.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]);
  assert(hrefs.length > 0, `${template.file} must contain a stable app link.`);
  for (const href of hrefs) {
    assert(!href.includes('123456'), `${template.file} must never put the OTP in a link.`);
    assert(!/\/auth\/v1\/verify|token(hash)?=/i.test(href), `${template.file} contains an auth verification link.`);
  }
}

console.log(`Validated ${loadedTemplates.length} scanner-resistant Bloomjoy auth email templates.`);
console.log('Stable-link prefetch simulation: PASS (no OTP or /auth/v1/verify URL in any href).');

if (!hasFlag('--apply')) process.exit(0);

const projectRef = readArg('--project-ref');
const confirmedProjectRef = readArg('--confirm-project-ref');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
assert(projectRef, '--project-ref is required with --apply.');
assert(confirmedProjectRef === projectRef, '--confirm-project-ref must exactly match --project-ref.');
assert(accessToken, 'SUPABASE_ACCESS_TOKEN is required with --apply.');

const endpoint = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`;
const headers = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
};
const currentResponse = await fetch(endpoint, { headers });
assert(currentResponse.ok, `Unable to read hosted auth configuration (${currentResponse.status}).`);
const currentConfig = await currentResponse.json();
assert(
  currentConfig.mailer_otp_length === 6,
  `Hosted email OTP length must be 6 before deployment; received ${currentConfig.mailer_otp_length ?? 'unknown'}.`
);

const payload = Object.fromEntries(
  loadedTemplates.flatMap((template) => [
    [template.subjectKey, template.subject],
    [template.contentKey, template.content],
  ])
);
const updateResponse = await fetch(endpoint, {
  method: 'PATCH',
  headers,
  body: JSON.stringify(payload),
});
assert(updateResponse.ok, `Hosted auth template update failed (${updateResponse.status}).`);

const verificationResponse = await fetch(endpoint, { headers });
assert(
  verificationResponse.ok,
  `Unable to read back hosted auth templates after update (${verificationResponse.status}).`
);
const verifiedConfig = await verificationResponse.json();
for (const [key, expectedValue] of Object.entries(payload)) {
  assert(
    verifiedConfig[key] === expectedValue,
    `Hosted auth template read-back mismatch for ${key}; publication is not verified.`
  );
}

console.log(`Published and read-back verified scanner-resistant auth templates on confirmed project ${projectRef}.`);

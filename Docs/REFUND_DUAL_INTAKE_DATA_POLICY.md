# Refund Dual-Intake Data Policy Decision Packet

Status: **PENDING OWNER AND PRIVACY/SECURITY APPROVAL — production copying remains off**

Last audited: 2026-08-04

Tracking: `#705`; implementation gaps `#710` and `#711`; pilot gate `#707`

## Purpose

This packet defines the recommended data-minimization, access, retention, deletion, attachment, evidence, and shutdown rules for the temporary refund soft cutover:

- email customers use the Bloomjoy website refund form;
- SMS customers may use the legacy Google Form;
- valid submissions become cases in the Hub;
- the designated Gmail mailbox may later provide label-scoped email-assistant transport; and
- Machine Managers perform official decisions and refund actions only in the authenticated Hub portal.

This document is a decision packet, not approval. It does not enable production Gmail or Sheet copying, customer sends, source deletion, attachments, GPT, or Nayax execution.

## Recommended pilot decisions

| Decision | Recommended default | Approval state |
| --- | --- | --- |
| Google Form/Sheet successful transport copies | Eligible for deletion 30 days after confirmed Hub ingestion and reconciliation. | Pending |
| Google Form/Sheet unresolved or quarantined copies | Retain only while actively unresolved, with a 90-day maximum unless a documented legal hold applies. | Pending |
| Hub Google bridge HMAC/aggregate ledgers | Retain 400 days after last activity; no customer content or raw source identifiers. | Pending |
| Hub canonical refund case and official audit | Use a proposed ceiling of seven years after case closure only if accounting/legal confirms the financial, tax, dispute, and jurisdiction-specific need; approve the actual schedule before adoption. | Pending |
| Gmail source mailbox | Keep under the approved Google Workspace/mailbox record policy; the Hub integration never deletes or reorganizes source mail. | Pending |
| Hub copy of Gmail message content | Accept the existing proposed 180-day maximum, with provider-independent local purge. | Pending |
| GPT-derived summary/draft content | Maximum 30 days; GPT remains off until its separate data-control approval. | Pending |
| New attachment copying | Disable for the pilot across Gmail and the hosted form until `#711` supplies an approved scanner, access, retention, and deletion path. | Pending |
| GitHub, workflow logs, alerts, screenshots, and QA artifacts | Zero customer content, addresses, phone digits, payment handles, filenames, provider identifiers, Form/Sheet identifiers, or raw payloads. Aggregate/redacted evidence only. | Required |

The 30/90/400-day values and seven-year ceiling are recommendations for explicit owner review. They are not claims about current Google or Hub deletion behavior or universal legal requirements. Official recordkeeping guidance makes the required duration depend on the action, expense, event, tax posture, dispute, and other obligations a record supports; the canonical schedule therefore needs accounting/legal confirmation. Issue `#710` is required because neither the Form response store nor the linked Sheet currently has a proven bounded cleanup workflow. Issue `#711` is required because hosted-form image uploads exist today without an approved pilot scanner/retention decision.

## Data-flow inventory

| System | Data/purpose | Allowed access | Retention/deletion | Owner state |
| --- | --- | --- | --- | --- |
| SMS provider | Sender number and message needed to deliver the instantaneous Form link. The SMS message itself is not copied into the Hub by the Google Form bridge. | Named SMS primary and backup only; provider support under audited access. | Provider policy and deletion/export behavior must be privately inventoried in `#704`. | Pending |
| Public Google Form | Customers submit the 11-field refund contract. Public users may submit but may not view responses. | Named Form owner and backup as the only human editors. | Apply the approved successful/unresolved schedule to the Form response store, not only the Sheet. Legal holds are case-specific. | Pending |
| Linked Google response Sheet | Temporary raw transport containing the same response values. It is not a queue or system of record. | Named owner and backup; dedicated bridge service account is Viewer-only. No broad links or domain-wide editor access. | Apply the same approved source schedule. Deleting a Sheet row alone is not sufficient evidence that the Form response was removed. | Pending |
| Sheet-to-Hub bridge | Reads the exact response contract, uses HMAC source/payload fingerprints, maps exact active locations, and writes aggregate health/quarantine reason codes. | Dedicated server-only service account and sync secret; no browser role. | Viewer-only bridge cannot delete source data. HMAC/aggregate ledger follows the approved non-content schedule. | Draft only |
| Hub canonical refund case | Minimum customer/contact, machine, incident, amount/payment, status, communications, match, decision, and official-action audit needed to resolve the claim. | Assigned current Machine Managers for their mapped machines; central Super/Scoped Admins for unassigned drafts; service role for bounded transport/automation. | Proposed business-record schedule after closure. Privacy deletion/export requests require legal-hold review and controlled service procedures. | Implemented; retention pending |
| Hub Google bridge quarantine | Opaque source hashes, reason codes, timestamps, and case link where available. It intentionally excludes the raw Sheet row and customer content. | Service role; aggregate manager health only. | Non-content ledger schedule; resolved quarantine remains auditable without raw source values. | Draft only |
| Designated Gmail mailbox | Source customer messages and provider attachments under the mailbox's record policy. | Named mailbox owner/backup; Hub OAuth restricted to the exact mailbox, explicit refund label, Gmail read-only, and send. | Hub does not mark read, relabel, archive, trash, or delete source mail. Workspace owner handles source retention/deletion. | Production off |
| Hub Gmail text copy | Sanitized subject/body and minimum participants needed for one case thread and manager-reviewed replies. Full Luhn-valid card numbers are reduced to redacted last four before persistence. | Unassigned drafts only to central admins; assigned cases only to authorized mapped managers and service transport. Provider thread/message identifiers remain service-only. | Proposed 180 days from copied message receipt, then local content purge/redaction independent of Gmail OAuth. | Approval pending |
| Hub Gmail attachments | Potential PDF/JPEG/PNG bytes and metadata from labeled mail. | No manager access without an approved malware-clean result. | Recommended pilot state is disabled: do not copy bytes or metadata. Any future enabled path must be private, quarantined, scanned, and retention-bounded. | Blocked by `#711` |
| Hosted-form attachments | Existing optional private PNG/JPEG/WebP images used as incident evidence. | Authorized case viewers currently receive attachment metadata and private access through the Hub. | No approved scanner/retention/deletion policy is yet recorded; recommended pilot state is disabled until `#711` closes. | Blocker discovered |
| GPT triage | Minimized derived classification/summary/missing-field draft only; no refund decision or transaction selection. | Service job and human reviewer; no automatic customer send. | Maximum 30 days for derived content; canonical review outcome remains redacted. | Production off |
| GitHub/CI/alerts/QA | Counts, safe reason codes, timing, pass/fail, hashes, and synthetic artifacts only. | Repository participants according to GitHub access. | Never use GitHub as a customer record. Remove accidental exposure through the incident procedure, not normal issue editing alone. | Required |

## Sanitized Google Form contract

The Form and linked Sheet currently use exactly these response columns:

1. Timestamp
2. Your Name
3. Email Address
4. Location of Purchase
5. Date and Time of Incident
6. Incident Description
7. Request Amount
8. Payment Method
9. Last 4 digits of the credit card used
10. Refund Payment Preference
11. Venmo/Zelle Payment ID

The first six response facts include the required customer/contact/location/issue fields; amount, payment method, last four, and the cash-only second-page fields may be missing. Missing optional facts produce an incomplete Hub draft for humble follow-up, not invented data or an official action.

The Google Form has no file-upload question. Adding or renaming any response column must fail the bridge contract closed until its purpose, access, retention, and deletion behavior are approved.

Never collect or request full card numbers, CVV, expiration dates, bank/routing credentials, mobile-wallet credentials, passwords, government identifiers, or screenshots containing those values.

## Least-privilege access standard

### Google Form and Sheet

- Exactly one named primary owner and one backup may edit the Form and linked Sheet during the pilot.
- The bridge service account is Viewer-only on the one approved Sheet. It receives no Drive-wide, mailbox, Form-editor, or write/delete access.
- The cleanup path in `#710` uses a different owner-controlled authorization. Do not expand the bridge credential to make cleanup easier.
- Remove broad-link sharing, domain-wide editors, stale collaborators, and personal accounts not needed for operations.
- Review access before the pilot, monthly during the pilot, on every owner/backup change, and the same day a person's access ends.
- Keep the private inventory in an approved credential/access system. GitHub records roles and pass/fail only, not account or file identifiers.

### Gmail

- OAuth is bound to the exact designated support mailbox and explicit refund label.
- Scopes stay at Gmail read-only and send. The integration does not modify mailbox state or use Drive scopes.
- Send-as aliases require private owner verification before use; a matching address alone is not proof of authorized send-as.
- Revoking the refresh token stops new Gmail copying/sends without disabling website intake, the Hub queue, or approved local retention cleanup.

### Hub

- Browser roles never receive service-role keys, provider credentials, raw Gmail/Sheet identifiers, HMAC salts, or quarantine storage paths.
- A mapped current Machine Manager sees only cases for assigned machines. Unassigned drafts remain central-admin-only until one exact machine mapping is recorded.
- Manager-to-machine changes and terminated-user removal take effect before the next pilot shift and are verified with synthetic accounts.
- Service functions are narrow, server-only, default-off where external copying/sending is involved, and return aggregate/redacted health.

## Attachment policy

Recommended pilot decision: **disable new attachment copying from Gmail and the hosted website form** until `#711` is complete.

The Google Form already has no upload field. Gmail and website intake must behave consistently: an attachment cannot make the non-attachment refund request disappear, but unapproved bytes and filenames must not be copied. Customer recovery copy should apologize and ask for the required text facts without requesting sensitive payment screenshots.

If the owner later chooses an enabled attachment pilot, all of the following are mandatory:

- private storage and non-guessable server-derived paths;
- content-type and file-signature verification, bounded count/size, and a narrow allowlist;
- quarantine before malware scanning and no manager download while pending/error/unknown;
- a named scanner/version, timeout/error policy, and PII-free health alert;
- authorization tied to the same case/machine boundary as the manager view;
- confirmed byte deletion before metadata redaction;
- a bounded retention period no longer than the related copied content;
- synthetic polyglot, mismatched extension, duplicate, oversized, excess, scanner-failure, delete-failure, and unauthorized-access evidence.

This packet does not implement the hosted-form disable. `#711` remains a launch blocker until the owner selects disabled or approved-scanner behavior and the UI/server path matches that choice.

## Retention and deletion procedure

### Normal lifecycle

1. Copy only the minimum approved data into the Hub.
2. Confirm each source submission is represented by one Hub case or one visible quarantine item before any source copy is eligible for deletion.
3. Run source cleanup in dry-run mode first. Evidence contains counts and safe reason codes only.
4. Delete the eligible response from both the Google Form response store and linked Sheet through the owner-controlled path in `#710`.
5. Record a one-way deletion fingerprint, source category, policy version, timestamp, and outcome; never store the raw row or provider identifier in the deletion ledger.
6. Purge copied Gmail/derived content through the local service-only retention lane even when Google authorization is revoked. Do not delete source Gmail through Hub.
7. Preserve the canonical case and official audit under the approved business-record schedule.

### Customer access, export, correction, or deletion request

1. Receive the request through a private operations/privacy channel, never a GitHub issue.
2. Verify the requester and locate the case/source records inside the authorized production admin/service procedure.
3. Check legal hold, payment/financial-record, fraud/security, and dispute obligations before deletion.
4. Export only the approved customer-readable content through a private delivery method; exclude internal security, provider, HMAC, and unrelated-person data.
5. Correct or delete transport/derived copies where allowed. Delete or de-identify the canonical case only when the approved business-record policy permits it.
6. Record aggregate completion evidence under an opaque request reference. No customer identifier enters GitHub or ordinary logs.

### Legal hold

- A legal hold suspends deletion only for the identified records and approved duration.
- Hold reason/details stay in the private legal/privacy system; the operational ledger records only an opaque hold state.
- Removing a hold re-enters the record into the next eligible cleanup run; it does not trigger an unbounded destructive batch.

## Logs, metrics, alerts, and evidence

Permitted:

- counts by source/status/reason;
- median/p95 lag and oldest-item age;
- pass/fail, run time, policy version, and rollback duration;
- one-way HMAC fingerprints that cannot be reversed without a server-only salt;
- synthetic case references and fixtures expressly marked non-production.

Prohibited:

- customer or manager names, addresses, phone digits, free-text descriptions, payment handles, card digits, filenames, attachment content, or recipient lists;
- Gmail thread/message IDs, Google Form/Sheet/file IDs, provider account/transaction IDs, storage buckets/paths, OAuth tokens, client secrets, service-role keys, HMAC salts, or raw API payloads;
- screenshots of real customer rows, mailbox threads, case details, provider dashboards, or secret/configuration values.

If prohibited data appears, stop the affected lane, restrict the artifact, notify the privacy/incident owner, rotate exposed credentials when applicable, preserve an incident audit outside public GitHub content, and verify every retained copy is handled. Editing an issue is not sufficient containment by itself.

## Independent kill switches

| Lane | Stop new activity | What must remain available |
| --- | --- | --- |
| Google Sheet bridge | Disable the repository schedule variable, then the Edge enable switch; revoke Sheet Viewer access if compromised. | Website intake, existing Hub cases, manager portal work, Gmail-off state, and approved local retention. |
| Gmail intake/send | Disable the schedule, then the Edge integration; revoke the refresh token if compromised. | Website/Google Form intake, existing Hub cases, Sheet bridge state, and provider-independent local retention. |
| Google source cleanup | Disable its separate owner-controlled schedule/authorization. | Read-only bridge, Hub cases, and duplicate/quarantine reconciliation. |
| Attachments | Keep source-specific attachment switch/policy disabled. | Text-only intake and humble follow-up. |
| GPT | Disable GitHub, Edge, and database/data-control gates. | Deterministic intake/matching and human review. |
| Nayax official actions | Keep the separate execution gates fail-closed. | Triage, queue, customer follow-up, and manager review. |

No kill switch may silently delete data, mark a refund complete, send a success message, or enable a different lane.

## Synthetic approval tests

All evidence is aggregate and PII-free.

1. **Google access:** primary and backup locate the Form/Sheet; a synthetic unauthorized user cannot view responses; the bridge credential has Viewer-only access to one Sheet.
2. **Hub access:** Super/Scoped Admin can see an unassigned synthetic draft; a location-only manager cannot. After exact assignment, only current mapped managers can open it.
3. **Sheet revoke:** revoke the synthetic Sheet grant. New copying stops with a scoped health error; website intake, existing Hub cases, and manager work continue.
4. **Gmail revoke:** revoke synthetic OAuth. New Gmail copying/sends stop; local due-content cleanup still completes without a provider call.
5. **Source retention:** one successful synthetic response becomes deletion-eligible after the simulated policy age; one unresolved response is held; retry and reordered rows remain idempotent; both Form and Sheet copies reconcile before success.
6. **Hub retention:** due Gmail/GPT copied content is purged/redacted while the canonical synthetic case/audit remains under its schedule.
7. **Attachment disabled:** Gmail, Google Form, and hosted-form synthetic attachment attempts copy zero unapproved bytes/filenames and preserve the text-only request with recovery copy.
8. **Attachment enabled, only if approved:** every scanner/quarantine/authorization/retention failure fixture in `#711` passes.
9. **Offboarding:** remove a synthetic owner's/editor's/manager's access and confirm denial before the next pilot shift without breaking backup access.
10. **Quick disable/restore:** stop each lane independently, verify unaffected paths, restore only the known-good synthetic state, and record duration.
11. **Privacy request:** an opaque synthetic request locates, exports, holds or deletes the right records without placing identity/content in GitHub evidence.

## Required approvals

- Operations owner: **Pending**
- Operations backup: **Pending**
- Privacy/security owner and incident contact: **Pending**
- Google Form/Sheet 30-day successful / 90-day unresolved maximum: **Pending**
- Hub bridge HMAC/aggregate 400-day retention: **Pending**
- Hub canonical case schedule and proposed seven-year ceiling: **Pending accounting/legal/privacy confirmation**
- Hub Gmail copied-content 180-day maximum: **Pending**
- Gmail source mailbox policy: **Pending**
- Attachment decision by source: **Pending; recommended disabled for pilot**
- Access/offboarding review completed: **Pending**
- Synthetic retention/deletion/revocation/quick-disable evidence: **Pending**
- Approval date and policy version: **Pending**
- Final pilot go/no-go: **Pending**

Production Gmail/Sheet copying, source cleanup, and attachment processing remain off until the applicable owner fields and synthetic evidence are recorded in reviewed GitHub evidence without customer data or secret identifiers. Official refund/payment actions remain portal-only and separately gated.

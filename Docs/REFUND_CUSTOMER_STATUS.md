# Refund Customer Status Capability

Issue: `#993`  
Parent: `#628`

## Customer contract

The primary card form asks for machine/location, email, purchase date and approximate time, amount, the last four digits shown for the payment (plus a wallet flag when applicable), and one issue category. Name, phone, time confidence, card interaction/network, and narrative are optional and collapsed by default. Omitting optional detail never approves, matches, or refunds a transaction; exact matching and the same-case correction loop remain authoritative.

The customer tracker consumes only the allowlisted customer subset of `refund_lifecycle_v2` and maps it to:

| Canonical stage | Customer status | Next expectation |
| --- | --- | --- |
| `matching` | Request received | Bloomjoy compares the request with machine records. |
| `waiting_on_customer` | We need one detail | Reply in the existing Bloomjoy conversation with only the named detail. |
| `needs_transaction_selection`, `transaction_confirmed` | Reviewing your purchase | A manager reviews the matching purchase. |
| `awaiting_payout` | Preparing your reimbursement | Bloomjoy is confirming the reimbursement destination or recording the external payment. |
| `refund_initiated` | Refund initiated | Bloomjoy confirms the result; the customer does not resubmit. |
| `confirming_with_nayax`, `needs_refund_operations` | Confirming the refund | Bloomjoy owns the next check and will not ask the customer to troubleshoot Nayax. |
| `integrity_hold` | Confirming the refund | Bloomjoy is reconciling its own records; no customer or payment retry is requested. |
| `refund_confirmed`, `customer_notified` | Refund confirmed | “Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.” |
| `denied` | Review complete | The customer replies in the same conversation for another review. |
| `unable_to_complete` | We could not complete the refund | The record ended without being represented as a denial. |

Internal/test records are never returned by the customer capability reader. Manager actions, location provenance, provider-account scope, operations fields, and delivery-provider identifiers are also excluded.

Active state uses the contract's five-second refresh interval, never exceeds 15 seconds, pauses while hidden, backs off on transport errors, resumes after reconnect/focus, deduplicates by capability, and stops at terminal state.

## Capability threat model

- Token: 32 cryptographically random bytes (256 bits), base64url encoded. Only its SHA-256 digest is stored. Refund message and Gmail transport audit bodies replace the delivery URL with a fixed redaction marker and link to the digest capability row; the raw token exists only in the customer delivery and same-tab browser session.
- Transport: the raw token is carried in a URL fragment, so it is absent from CDN/server request logs and referrer headers. The page moves it into same-tab session storage and clears the visible fragment immediately.
- Scope: one refund case and read-only lifecycle access. The Edge response allowlists eight customer fields and drops case IDs, manager actions, lookup detail, operations detail, provider evidence, codes, and internal reasons.
- Lifetime: 30 days by default, configurable from 7 through 45 days. Each capability can be revoked; case-wide revocation supports rotation/security hold.
- Abuse resistance: per-access-key minute windows allow 20 reads, audit only one-way access-key digests and generic outcomes, and retain access evidence for no more than 30 days. Expired evidence is pruned by status reads and every authorized automation sweep, including while customer automation is disabled. Invalid, malformed, expired, revoked, and guessed capabilities share one generic response; the Edge boundary adds a fixed minimum timing envelope.
- Browser privacy: `private, no-store`, `no-referrer`, `noindex/nofollow/noarchive/nosnippet`, a status-route CSP without third-party analytics, no lead-attribution capture, and no provider-write route.

## Rollout and rollback

`REFUND_STATUS_LINKS_ENABLED=false` is the independent default. Deployment may apply the table/RPC/route with issuance off. Reviewed activation verifies that Resend domain click/open tracking is disabled, sets the status origin to `https://app.bloomjoyusa.com`, the TTL to `30`, then enables issuance after synthetic mobile/security UAT. [Resend tracking is off by default](https://resend.com/docs/dashboard/domains/tracking), but production must prove the actual domain setting because click tracking would rewrite the capability URL through a third party. This does not alter Nayax execution, customer-contact, Gmail, automation, or manager-action gates.

On leakage, enumeration, false status, duplicate effects, or inability to read the canonical contract:

1. set `REFUND_STATUS_LINKS_ENABLED=false`;
2. revoke affected case capabilities with `security_hold`;
3. preserve access audit and lifecycle evidence;
4. keep the existing reference/reply support path available;
5. do not change or retry any payment.

Monitor aggregate issuance, active/expired/revoked capability counts, available/unavailable/rate-limited access outcomes, lifecycle parse failures, and status Edge errors. Do not put tokens, digests, case IDs, customer data, or provider identifiers in monitoring output.

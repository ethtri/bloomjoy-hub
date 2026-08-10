# Public Lead Attribution

Issue: `#616`

## Purpose and boundary

Bloomjoy needs to distinguish how a public lead arrived and which controlled buyer context preceded submission. This implementation is lead attribution, not a general marketing profile. It does not grade leads, automate outreach, add consent fields, or send data to a new platform.

## Browser lifecycle

- Storage key: `bloomjoy.lead_attribution.v1`.
- Storage: `sessionStorage` only. Closing the tab/window ends the browser-side retention window. Storage failures or disabled storage never block contact submission.
- First touch: created once per tab/session and then kept unchanged.
- Last touch: changes only when the current route provides a new qualifying touch:
  - one or more accepted UTM values;
  - a new external referring hostname;
  - an explicit normalized internal `source` path; or
  - controlled planner recommendation/band context.
- Ordinary SPA page changes do not refresh timestamps or overwrite last touch.

## Persisted schema

`public.lead_submissions.attribution` is an additive, non-null JSON object with a database default of `{}`. New submissions use this versioned shape:

```json
{
  "version": 1,
  "first_touch": {
    "kind": "campaign",
    "landing_path": "/machines/commercial-robotic-machine",
    "utm_source": "example_source",
    "utm_medium": "example_medium",
    "utm_campaign": "example_campaign"
  },
  "last_touch": {
    "kind": "planner",
    "landing_path": "/contact",
    "internal_source_path": "/resources/business-playbook/planner",
    "planner_recommendation": "commercial",
    "planner_band": "clear"
  },
  "conversion": {
    "source_path": "/resources/business-playbook/planner",
    "machine_interest": "Commercial Machine",
    "planner_recommendation": "commercial",
    "planner_band": "clear"
  }
}
```

All fields are optional except `version`; absent or rejected context is omitted rather than replaced with untrusted text. Historical rows remain `{}` and are not backfilled.

## Exact allowlist and limits

| Field | Accepted values / limit |
| --- | --- |
| `kind` | `direct`, `organic`, `referral`, `campaign`, `internal`, `planner` |
| `landing_path`, `internal_source_path`, `source_path` | Internal pathname only; no query or fragment; 160 characters |
| `referrer_host` | Lowercase hostname only; 253 characters |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Conservative token text; 80 characters each |
| `machine_interest` | `Commercial Machine`, `Mini Machine`, `Micro Machine`, or `Not sure yet` |
| `planner_recommendation` | `commercial`, `mini`, `micro`, `undecided` |
| `planner_band` | `clear`, `close_call`, `exploring`, `blank`, `low`, `medium`, `high` |

The server drops unknown keys, invalid types, over-limit values, URLs where tokens are expected, control characters, and values matching conservative email/phone-like patterns. Campaign click IDs such as `gclid`, `gbraid`, `wbraid`, and `fbclid` are not read or persisted because they have not been explicitly approved.

## Planner boundary

The Machine Fit planner may pass only its categorical recommendation and `clear`, `close_call`, or `exploring` state. The payback planner may pass only its selected scenario and categorical demand band. Startup cost, price, volume, margin, payback, revenue-share, rent, fee, and other exact assumptions never enter attribution.

## Server, RLS, and notifications

- The Edge Function reconstructs the object from the exact allowlist before insert. Missing, malformed, or tampered attribution is reduced to a safe versioned conversion object and does not break an otherwise valid lead.
- The JSON column has an object-type and size constraint. No new index is added until a real reporting query demonstrates the need.
- Existing `lead_submissions` RLS remains authoritative. This change adds no anonymous/authenticated select grant and no new public policy.
- Quote/procurement notifications receive a compact summary made from the sanitized stored object. Raw request attribution is never interpolated directly.
- Lead dedupe and dispatch claims remain unchanged. A notification failure remains non-blocking and does not create another row.

## Retention and deletion

Persisted attribution exists only inside its lead row and follows the same retention/deletion lifecycle as that row. This issue creates no secondary analytics copy and no independent retention extension. When a lead is deleted under Bloomjoy's lead-retention process, its attribution is deleted with it.

## Deployment and rollback

1. Apply the additive migration.
2. Deploy the intake function that accepts and sanitizes the new field.
3. Deploy the SPA capture/payload code.
4. Verify sanitized direct, campaign, referral, internal, planner, malformed, and missing cases before relying on reporting.

Rollback reverses the SPA and function first. The column may then be dropped in a later reviewed migration after confirming no deployed function or report reads it. Existing lead submission behavior continues when attribution is absent.

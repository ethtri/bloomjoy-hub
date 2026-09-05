# Nayax payment-identifier semantics

Status: research decision record for #1161, reviewed against repository source and public primary documentation on 2026-09-05. This document describes evidence; it does not change refund eligibility or authorize a payment, customer message, or vendor contact.

## Evidence labels

- **Documented**: an Apple, EMVCo, Visa, or Nayax primary source directly supports the statement.
- **Bloomjoy-observed**: a sanitized production inventory or delivered-report contract records the field. It does not establish semantics that the source did not provide.
- **Synthetic**: a repository fixture exercises Bloomjoy code with invented values. It proves code behavior only.
- **Unknown**: neither current primary documentation nor sanitized Bloomjoy evidence establishes the meaning needed for matching.

These labels are deliberately narrow. A field's presence does not prove its meaning, and a masked number is not automatically the number printed on a customer's card.

## What the current surfaces provide

| Surface and field | Current evidence | What Bloomjoy may conclude | What remains unknown |
| --- | --- | --- | --- |
| Lynx Last Sales `TransactionID` | **Documented.** Nayax identifies it as the transaction identifier. Bloomjoy also observed it in the production inventory. | It identifies the sale returned by Last Sales. Together with the exact `SiteID` and source `MachineAuthorizationTime`, it is the refund execution binding. | Nothing in its definition links related card tokens or separate purchases. |
| Lynx Last Sales `SiteID` and `MachineAuthorizationTime` | **Documented.** Both are in the current public response example/schema and refund request contract. | Preserve the raw values with `TransactionID`; do not substitute a server/GMT timestamp for the machine authorization value. | `SiteID` was absent from Bloomjoy's earlier captured field inventory, so its presence must still be validated on the exact candidate before execution. |
| Lynx Last Sales `CardNumber` | **Documented, incomplete.** Nayax calls it the card number used for payment and shows a masked example. Bloomjoy's matcher accepts `CardNumber`/`cardNumber` and extracts the final four digits. | It is a masked payment identifier that can provide evidence once its source is known. | Nayax does not say whether it is a magnetic-stripe PAN, chip application PAN, wallet Device Account Number/payment token, processor token, or customer-recognizable display value. It was not in Bloomjoy's earlier production field inventory. |
| DTM `Card Number` | **Documented, incomplete.** Nayax says it shows the first four and last four digits of the card information used in the transaction. | The portal masks the value. A sanitized suffix may be recorded as portal evidence with its surface and entry mode. | The documentation does not define the underlying identifier for each entry mode or say that this value equals Last Sales `CardNumber`. |
| Visa mobile receipt/display last four | **Documented network behavior.** Visa says a tokenized mobile application can provide a `Last 4 Digits of PAN` data object so the merchant displays an account number the cardholder recognizes instead of the tokenized Application PAN suffix. | A merchant-facing/displayed suffix is not necessarily the identifier transmitted for authorization. | Nayax does not say whether Last Sales, DTM, or transaction delivery uses this data object. This Visa rule cannot be generalized to every network. |
| Transaction-delivery `Card String` | **Documented, incomplete.** Nayax's SQS transaction-delivery field guide describes it as the first four and last four digits of the payment card. | This is a separate transaction-delivery field and must retain that provenance. | It is not part of Bloomjoy's current Last Sales integration or delivered scheduled-email CSV. The guide does not define PAN/token semantics by entry mode or prove equivalence with Last Sales/DTM fields. Do not alias it automatically to `CardNumber`. |
| Lynx Last Sales `CardBrand` | **Documented, incomplete.** Nayax calls it the brand of the card used for payment. Bloomjoy accepts several possible aliases and normalizes familiar network names. | It can be supporting network/brand evidence when present. | The public contract does not define wallet or processor behavior, and it was not in Bloomjoy's earlier production field inventory. Synthetic fixtures are not proof that production returns a value. |
| Lynx Last Sales `RecognitionMethod` | **Documented, incomplete; Bloomjoy-observed present.** Nayax says it describes how payment was recognized. Bloomjoy's earlier production inventory included the field, without a published value census. | Preserve the raw value privately and a sanitized category separately. | Nayax's Last Sales documentation provides no enum or guarantee that it distinguishes a physical contactless card from a wallet. Bloomjoy's keyword mapping to `wallet`, `contactless`, `chip`, `swipe`, or `present` is a heuristic, not a provider contract. |
| DTM `Card Type` / `Payment Method (Source)` | **Documented.** Nayax lists `CON` (chip/insert), `MCR` (swipe), `CLS` (contactless), and `NFC`, and says the two columns report how the card was used. | DTM can provide portal entry-mode evidence. | Generic `CLS`/`NFC` does not distinguish a physical tap from Apple Pay or Google Pay. The documentation does not prove these columns equal Last Sales `RecognitionMethod`. |
| Lynx Last Sales `PaymentMethod` | **Documented; Bloomjoy-observed present.** Nayax calls it the method used for payment. | It is a payment-channel field and may complement recognition evidence. | No Last Sales enum or reliable mapping to card interaction/device is published. |
| Scheduled-email CSV `payment_method_id_enc` | **Bloomjoy-observed.** It is the sole payment-context field in the delivered and allowlisted CSV contract. | Preserve it as an opaque provider value; the current importer does this. | It has no published mapping to card network, interaction, device, PAN, or token. The CSV contains no accepted card suffix, brand, or recognition field. |
| `PaymentServiceTransactionID` and `PaymentServiceProviderName` | **Documented; Bloomjoy-observed present.** Nayax describes them only as processor transaction details/name. | Retain only where required for provider reconciliation and under current privacy controls. | Stability, uniqueness scope, cross-token linkage, and refund-binding role are not documented. Bloomjoy's refund request does not use them. |
| DTM `Authorization RRN` | **Documented.** Nayax calls it a Retrieval Reference Number and says it can locate a transaction by confirmation number. | It may help an operator find the exact DTM row. | It is absent from Last Sales and the current scheduled-email CSV; its uniqueness scope and suitability as an automated account-linking identifier are not established. It is not the refund execution key. |
| SQS `Authorization Code`, `Token`, phone/contactless flags, EMV flag | **Documented as available transaction-delivery fields, with mostly type-level descriptions.** | These fields are possible subjects for provider research if that delivery channel is ever in scope. | `Token` is not defined as an EMV payment token or PAR. These fields are absent from Bloomjoy's current integration and cannot be inferred from other fields. |
| AID / selected chip application | **Unknown.** No field was found in the current Last Sales schema, DTM default-field guide, delivered scheduled-email CSV, or reviewed transaction-delivery dictionary. | None. | Availability through a custom portal report, processor, or other Nayax API is unknown. |
| Payment Account Reference (PAR) or equivalent | **Network concept documented; Nayax availability unknown.** EMVCo defines PAR as a way to link transactions using payment tokens to the PAN. Visa describes one PAR connecting physical and virtual versions of a Visa account. | PAR could reduce ambiguity without using PAN if an authorized provider surface supplies it. | No PAR field was found in the reviewed Nayax surfaces. Visa PAR is network-specific; access, coverage, persistence, commercial cost, and Nayax support are unknown. `Token`, RRN, and processor transaction ID must not be relabelled as PAR. |

Sources:

- [Nayax Last Sales guide](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/machines/getting-a-machines-last-sales)
- [Nayax Last Sales API reference](https://devzone.nayax.com/reference/lynx/machines/get-last-sales-for-machine-by-machineid)
- [Nayax Dynamic Transaction Monitor field guide](https://nayax-u.nayax.com/article/dynamic-transaction-monitor-dtm-in-nayax-core-overview-10787)
- [Nayax transaction-delivery JSON field guide](https://nayax-u.nayax.com/storage/4/7/cache/k2O9yxygDqdQvqE3.pdf)
- [Nayax card-present transaction types](https://nayax-u.nayax.com/article/card-present-transaction-types-payments-101-2072)
- [Nayax refund request](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds) and [approval](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund)
- [Apple Pay refund guidance](https://support.apple.com/en-us/118270)
- [Apple Pay security and privacy](https://support.apple.com/en-us/101554)
- [Apple card-provisioning security](https://support.apple.com/guide/security/card-provisioning-security-overview-sec0f005981a/web)
- [Visa Transaction Acceptance Device Guide, version 3.3](https://usa.visa.com/content/dam/VCOM/regional/na/us/partner-with-us/documents/transaction-acceptance-device-guide.pdf)
- [EMVCo payment tokenisation overview](https://www.emvco.com/emv-technologies/payment-tokenisation/)
- [Visa PAR Inquiry](https://developer.visa.com/capabilities/visa-par-inquiry)

## Payment-interaction matrix

| Customer interaction | Documented identifier behavior | Nayax/Bloomjoy evidence | Current conclusion for suffix comparison |
| --- | --- | --- | --- |
| Magnetic-stripe swipe | Nayax says it reads Track 2, which contains the PAN, and that magnetic-stripe data is static. | DTM can label `MCR`; Last Sales can expose `RecognitionMethod` and masked `CardNumber`, but their exact relationship is undocumented. | A physical-card suffix mismatch is negative evidence. It is exclusionary only after the provider field is proved to be the same Track 2 PAN representation for this surface and payment type. |
| Contact chip insert | Nayax says the reader uses the embedded EMV chip. Visa says data from chip and magnetic-stripe interfaces need not match; a multi-application card can expose a different PAN through the chip. | DTM can label `CON`; the Last Sales documentation shows a synthetic-looking `Chip` example but does not define field semantics. | A mismatch against digits taken from the physical card is not a universal veto. Treat it as negative or internal-review evidence until the selected application and displayed-field source are known. |
| Physical-card contactless tap | Nayax says contactless uses NFC/RFID and that the same contactless class also includes mobile wallets. | DTM may show `CLS` or `NFC`; Last Sales has no documented physical-card-versus-wallet discriminator. | Generic contactless evidence is insufficient to decide that two suffixes should match. A mismatch must not be the sole hard stop; unresolved close candidates stay in internal review or use one useful correction. |
| Apple Pay on iPhone | Apple says the device sends a device-specific Device Account Number and a separate transaction-specific dynamic security code; the actual physical card number is not sent. Apple's refund guidance directs the user to the Apple Pay last four on the device used. | Nayax supports Apple Pay as contactless, but its public field documentation does not say whether `CardNumber`/DTM displays the Device Account Number, another token, or a customer-facing value. | Physical-card digits and iPhone Apple Pay digits are different sources. Their mismatch is neutral for identity unless Nayax proves a cross-source rule. The exact iPhone's Apple Pay last four is the useful customer value. |
| Apple Pay on Apple Watch | Apple says cards are specifically enrolled for Apple Watch and have their own Device Account Numbers. Its refund guidance shows how to retrieve the Apple Pay last four on the watch. | Nayax classifies wallet use as contactless; no public Nayax field distinguishes phone from watch. | Ask which device was used and request the Apple Pay last four from that exact device. Do not reuse the phone suffix or physical-card suffix as though it were the watch identifier. |
| Other phone/watch wallet | Nayax documents Google Pay support through contactless. | No reviewed primary wallet-specific source or Nayax identifier contract establishes the token/suffix behavior for Bloomjoy's surfaces. | Mark semantics unknown. Do not generalize Apple-specific Device Account Number behavior into a provider rule or use a generic contactless mismatch as a veto. |

The changing value in an Apple Pay purchase is the transaction-specific security code, not a newly random card suffix on every tap. Visa separately describes application cryptograms as values generated by a card application from card, terminal, and transaction data. Neither source establishes that Nayax puts a cryptogram into any displayed card-number field.

## Evidence classification for matching work

This is the research input for #1162; the deployed policy remains unchanged until that issue implements and verifies a server-side rule.

| Classification | Required evidence | Meaning |
| --- | --- | --- |
| Exclusionary | Both values are proved to represent the same identifier source and scope for the exact provider surface and entry mode, and the comparison is server-derived. | A mismatch can eliminate that candidate, subject to the normal exact-transaction and stale-version controls. None of the current cross-surface physical-card/tap/wallet comparisons meets this bar universally. |
| Negative | The customer and provider values are likely comparable but the provider mapping or application scope is incomplete. | Lower confidence and explain the conflict; do not create an actionless dead end from this fact alone. |
| Neutral | The values come from different known scopes, such as a physical card and Apple Pay device number, or the provider exposes only generic contactless. | Do not reward or penalize the candidate for the mismatch. Use other exact evidence or obtain the missing same-source fact once. |
| Internal-review trigger | The provider field is missing, its semantics are unknown, close candidates remain, or a contradiction cannot be resolved with one material customer answer. | Keep payment disabled for the unresolved exact transaction, give Refund Operations a concrete next step, and allow unrelated eligible refunds to continue. |

Identifier uncertainty never makes an arbitrary same-price purchase safe. The hard controls remain exact account/machine/purchase binding, amount and currency, transaction uniqueness, case/version checks, duplicate/already-refunded checks, one durable attempt, idempotency, and inspection of uncertain outcomes before any retry.

## Customer facts that can change the result

Ask these together only when the answer distinguishes current candidates; preserve “Not sure” and “I can't provide this.” Do not request a full card number, expiration date, security code, wallet password, card screenshot, or bank screenshot.

1. **How did you pay at the reader?** Tapped a physical card, inserted its chip, swiped it, used a phone wallet, or used a watch wallet.
2. **Which exact device was used for a wallet purchase?** Phone or watch. For Apple Pay, ask for the last four of the Apple Pay card number shown in Wallet on that device.
3. **Which card network did that instrument show?** Visa, Mastercard, Discover, American Express, Other, or Not sure. For a wallet, use the card shown in that wallet.
4. **Where did the supplied last four come from?** Physical card, Apple Pay on the phone, Apple Pay on the watch, another wallet, statement, or Not sure.
5. **How precise is the purchase time?** Exact from a receipt or transaction history, approximate, or Not sure. Keep the customer's local time; the system owns timezone conversion.
6. **Were there multiple nearby charges or attempts?** Ask only when candidates share machine/amount/time. Capture the number and amounts of charges the customer sees, without collecting screenshots or full payment details.

Do not ask the customer to resolve Bloomjoy machine/account mapping, interpret provider fields, calculate a timezone, or choose from raw provider transactions.

## Sanitized observation matrix

Current repository tests are **synthetic**. They prove that Bloomjoy parses a masked `CardNumber`, normalizes some `CardBrand` values, and maps recognition text by keyword. They do not prove what production Nayax values mean.

The next observations can use already-known authorized purchases or future naturally occurring, identifiable purchases. They do not require a refund or a manufactured charge. Store only the mode, surface, field presence, sanitized suffix comparison result, and stability category; keep raw provider payloads and identifiers out of GitHub.

| Mode | Minimum observation | Current state |
| --- | --- | --- |
| Physical swipe | Compare a known swipe's physical-card last four with DTM `Card Number`, Last Sales `CardNumber`, raw `RecognitionMethod`, and `PaymentMethod`; record whether the two Nayax surfaces agree. | Documentation covers Track 2 behavior; Bloomjoy production mapping is unproved. |
| Chip insert | Record the same fields plus any exposed application/AID indicator. Never compare chip and stripe as a presumed invariant. | Visa documents possible interface PAN differences; Nayax application/display behavior is unproved. |
| Physical tap | Establish physical tap independently of a generic contactless flag, then compare DTM and Last Sales fields. | Generic contactless is documented; physical-card suffix behavior is unproved. |
| Apple Pay on iPhone | Compare the exact iPhone Apple Pay last four with the two Nayax surfaces and record repeat stability without retaining raw values. | Apple device-number behavior is documented; Nayax display behavior is unproved. |
| Apple Pay on Watch | Compare the exact watch Apple Pay last four separately from the paired phone. | Apple says the watch has its own Device Account Number; Nayax device distinction is unproved. |
| Other supported wallet | Use that wallet's own primary documentation before defining an expected identifier; compare only after the exact device/wallet is known. | Nayax documents contactless support; identifier semantics remain unknown. |

Stop once #1162 has enough evidence to avoid a false hard exclusion and preserve an internal resolution path. Exhaustive mode coverage and PAR access are useful follow-up research, not gates for unaffected qualified refunds or the next authorized API attempt.

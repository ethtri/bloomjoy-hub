# WeChat Integration Evaluation (#54)

Date: 2026-03-10
Branch: `agent/wechat-eval`

## Goal
Assess viable integrations with WeChat for manufacturer communication and internal team messaging.

## Source Baseline (Official Tencent Docs)
- WeChat Open Platform website login:
  - https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html
- WeCom (Enterprise WeChat) `access_token`:
  - https://developer.work.weixin.qq.com/document/path/91039
- WeCom OAuth2 web authorization (internal app context):
  - https://developer.work.weixin.qq.com/document/path/91335

Validated during this session on 2026-03-10.

## Feasible Options
| Option | Primary use | Feasibility now | Notes |
| --- | --- | --- | --- |
| A. Keep manufacturer support in current WeChat threads and formalize process | Manufacturer communication | High | No API dependency; fastest path for current operations. |
| B. Use WeCom internal app/group bot for operational alerts | Internal team messaging | Medium-High | Requires enterprise setup and server-side token lifecycle. |
| C. Add WeChat Open Platform website login/account linking | Login and identity | Medium | Requires approved website app and authorized redirect domain alignment. |
| D. Build bidirectional sync with manufacturer chat | Unified inbox automation | Low | High dependency risk unless manufacturer can provide supported enterprise integration endpoints. |

## Requirements and Constraints
### API and account constraints
- WeChat Open Platform website OAuth uses authorization code flow and `scope=snsapi_login`.
- `redirect_uri` domain must match authorized domain configuration in Tencent.
- WeCom API access requires `corpid` + `corpsecret` to request `access_token`.
- WeCom guidance states token handling is backend-only (do not return `access_token` to frontend).
- WeCom `access_token` is app-scoped and has documented expiry (`expires_in=7200`), so each app needs its own token lifecycle.

### Regional and compliance considerations
- Tencent account capability and app review/approval are external dependencies.
- [Inference] Cross-border data handling/privacy obligations should be reviewed before production rollout.
- [Inference] Manufacturer chat setup may not expose API-accessible endpoints, so chat-channel automation can be constrained by account type.

## Recommendation
Use a hybrid path:
1. Keep manufacturer communication in existing WeChat channels (Option A) and codify an internal runbook.
2. Run a limited WeCom internal messaging POC for Bloomjoy team notifications (Option B).
3. Defer full chat-sync automation (Option D) until manufacturer API capability is confirmed.

## Effort Estimate
- Option A runbook/process hardening: 0.5 day.
- Option B POC (one-way notifications from existing backend events to WeCom): 2-4 engineering days.
- Option C website login rollout (if needed later): 3-5 engineering days plus Tencent review lead time.
- Option D bidirectional sync: not recommended this sprint; discovery first.

## Clear Next Step (POC)
Execute a 1-week POC for Option B:
- Send quote, order, and support lifecycle events to a test WeCom chat/app.
- Measure delivery success rate, latency, and operator usefulness.
- Exit criteria: >=95% successful delivery in test window, retry/error logging, and owner sign-off.

If POC passes, open implementation work for production rollout. If POC fails, document blockers and keep the manual path as the default.

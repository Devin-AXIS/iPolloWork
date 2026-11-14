# Official services and billing

This reference covers server-supplied credentials and credit accounting. Private keys are edited in the service center and are never returned in the public catalog. Plugins may select their own native credentials instead; BYOK requests do not debit this service's ledger.

## Presets and prices

The initial catalog contains four disabled connections. Alibaba chat and speech share the `aliyun-bailian` key; MiniMax image and video share the `minimax` key. Multiple capabilities route by allowed method and path rather than overwriting one another.

| Service | Model | Catalog price in CNY |
| --- | --- | --- |
| Alibaba chat | `qwen3.8-flash` | Input 0.8, output 2.7 per million tokens |
| Alibaba chat | `qwen3.8-max` | Input 12, output 36 per million tokens |
| Alibaba chat | `vanchin/deepseek-v4.1-flash` | Input 2, output 8 per million tokens |
| Alibaba speech | `qwen3-tts-flash` | 0.8 per 10,000 characters |
| MiniMax image | `MiniMax-H3-Image` | Text input 15, image input 10, output 25 per million tokens |
| MiniMax video | `MiniMax-H3` | 768P 0.50/second; 2K 0.80/second; input video seconds also billable; extra reference images after five cost 0.20 each |

Price sources are [Alibaba model pricing](https://help.aliyun.com/zh/model-studio/model-pricing) and [MiniMax pricing](https://platform.minimax.cn/docs/pricing/overview). The seed records a 2026-11-14 review with expiry on 2026-12-14. It excludes short promotional discounts. Operators must review and update the billing object before its expiry; expired cards reject new chargeable requests. Editing the UI preserves the stored billing object. Review the provider's region, model availability and full API terms before enabling a connection.

## Settlement

One credit represents 0.001 CNY of provider usage; costs use integer micro-CNY and round up only when converted to credits. Chat reserves a conservative request/output bound, requires final usage, and settles SSE usage at completion. Images reserve a bounded token budget and settle the provider's separate text, image and output tokens. Speech reserves text characters. Video submission reserves output duration, input-video allowance and extra reference images; an owned terminal task result settles the reservation. Missing usage retains the reservation for review. Underestimated bounds stop that service instead of silently charging more than reserved.

Definitive upstream rejection refunds once. Timeouts, connection loss and incomplete responses remain unknown. An administrator must check the provider before reconciling. A terminal reconciliation prevents later polling from refunding again. Request replay never re-executes an upstream job. Polling another account's job is forbidden even when the accounts share a provider key.

## Membership drafts

[OpenDesign's plans](https://open-design.ai/pricing/) informed the two-tier structure; its prices and credit bonuses are not copied.

| Disabled draft | Price / term | Included credits | Provider-cost budget |
| --- | --- | --- | --- |
| Standard | CNY 99 / 30 days | 40,000 | CNY 40 |
| Pro | CNY 299 / 30 days | 160,000 | CNY 160 |

Enabling or selling a plan checks its CNY income against credit cost, `PAYMENT_FEE_BPS` (default 5%), `MINIMUM_MARGIN_BPS` (30%) and `MEMBERSHIP_OPERATING_RESERVE_FEN` (CNY 30). Credit redemption cannot mint more credits than it consumes. These are configurable accounting guards, not a profitability guarantee: OSS storage, egress, support, taxes and actual payment fees must fit the remaining budget. Quotas do not allocate physical space, but selling a plan with large storage usage can exceed that allowance.

Both plans and all official connections stay disabled until the operator supplies keys, tests real usage and payment settlement, reviews current prices and budgets OSS costs for the selected region. This release does not provide automatic renewal, paid storage upgrades or separate metered OSS-traffic charges. Administrators can adjust storage limits directly.

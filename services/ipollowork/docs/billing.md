# Official services and billing

This reference covers server-supplied credentials and credit accounting. Private keys are edited in the service center and are never returned in the public catalog. Plugins may select their own native credentials instead; BYOK requests do not debit this service's ledger.

## Presets and prices

The initial catalog contains disabled connections. Alibaba chat, images, video, speech, recognition and embeddings share the `bailian` key; MiniMax image and video share the `minimax` key. Multiple capabilities route by the requested model as well as the allowed method and path. The administration page groups each provider's connections under one key editor. Alibaba includes ten recommended language models from Qwen, DeepSeek, MiniMax, Kimi, GLM and MiMo. The editor can show the complete saved catalog, and search covers every saved model and author. Seeding adds missing presets without changing operator names, prices, connection state or model switches; existing aliases remain saved.

The [Alibaba directory](https://help.aliyun.com/zh/model-studio/list-models) imports all authors from the configured business space's regional `/api/v1/models` endpoint. Set the shared origin to the console-provided `https://WorkspaceId.cn-beijing.maas.aliyuncs.com` address for Beijing workspaces, with a Key from that same space and region. Other regions use their own official origins. Model availability also depends on provider permissions. Unknown prices require operator review, and newly discovered models remain disabled. Presets use an editable 8,192-token output limit rather than the model's maximum generation length.

| Service | Model | Catalog price in CNY |
| --- | --- | --- |
| Alibaba chat | `qwen3.8-flash` | Input 0.8, output 2.7 per million tokens |
| Alibaba chat | `qwen3.8-max` | Input 12, output 36 per million tokens |
| Alibaba chat | `qwen3.7-plus` | Up to 256,000 input tokens: input 2, output 8; above: input 6, output 24 per million tokens |
| Alibaba chat | `deepseek-v4.1-flash` | Input 2, output 8 per million tokens, using peak rates |
| Alibaba chat | `deepseek-v4-pro` | Input 12, output 24 per million tokens |
| Alibaba chat | `MiniMax/MiniMax-M3.1-Flash` | Input 1, output 4 per million tokens |
| Alibaba chat | `MiniMax/MiniMax-M3` | Input 4.2, output 16.8 per million tokens |
| Alibaba chat | `kimi-k3.1-pro` | Input 13, output 68 per million tokens |
| Alibaba chat | `glm-5.3` | Input 8, output 28 per million tokens |
| Alibaba chat | `xiaomi/mimo-v2.6-pro-ultraspeed` | Input 30, output 60 per million tokens; audio input uses the same input rate |
| Alibaba speech | `qwen3-tts-flash` | 0.8 per 10,000 characters |
| MiniMax image | `MiniMax-H3-Image` | Text input 15, image input 10, output 25 per million tokens |
| MiniMax video | `MiniMax-H3` | 768P 0.50/second; 2K 0.80/second; input video seconds also billable; extra reference images after five cost 0.20 each |

Price sources are [Alibaba model pricing](https://help.aliyun.com/zh/model-studio/model-pricing) and [MiniMax pricing](https://platform.minimax.cn/docs/pricing/overview). The seed records a 2026-11-14 review with expiry on 2026-12-14. It excludes short promotional discounts. Operators must review and update the billing object before its expiry; expired cards reject new chargeable requests. Editing the UI preserves the stored billing object. Review the provider's region, model availability and full API terms before enabling a connection.

The model editor accepts currency per million tokens, per image, per audio/video second or per ten thousand characters and displays the equivalent credits. Values persist in integer millionths of CNY. Optional context tiers, resolution tiers and cache prices apply to that model. Unpriced models and expired prices are omitted from the user catalog; zero-cost models need an explicit free marker. Provider built-in web search is rejected until its additional charges are priced. New input/output unit fields are optional, so existing price records remain readable.

Discovery retains models with unsupported protocols under Other models. Those entries stay disabled until an operator supplies supported routes and reviewed prices. Language models with missing context or output limits are also retained as disabled entries; enabling one requires explicit limits. Directory reads reject incomplete or duplicate pages without changing saved models. Time-of-day price bands use the highest listed charge; temporary discounts do not lower the reserved cost.

Ark image and video services share the `volcengine-video` key and the native `volcengine-video` provider. The catalog includes Seedance 2.0, Seedance 2.5 and Seedream 5.5. [Ark pricing](https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing) is reviewed on 2026-11-14. Video rates vary by output resolution and whether reference video is present; the terminal `usage.completion_tokens` determines cost. Reservations use configured frame-pixel, frame-rate, output-duration and reference-duration limits. Draft continuation is rejected until its inherited input has a verified price. Images charge each input image and each successful output's pixel tier, including layers. Missing sizes or inconsistent counts retain the reservation for review. Keys and these services remain disabled until configured.

Ark uses one IAM API Key authorized for both Ark and Doubao Speech. The shared-key editor leaves each service origin intact: Ark models use `ark.cn-beijing.volces.com`, while speech uses `openspeech.bytedance.com` and `X-Api-Key`. The model directory includes language, multimodal understanding, image, video, embedding, TTS 2.0, registered ICL voices, recorded-audio recognition and Seed Audio. The official `/models` endpoint imports new model IDs without changing operator names, prices or enabled states; unknown protocols remain disabled under Other models. Speech billing uses provider `text_words`, recording duration in milliseconds and generated audio `original_duration`; hourly and minute prices avoid rounding the per-second unit. Standard recording tasks retain their reservation until an owned result query completes.

## Settlement

One credit represents 0.001 CNY of provider usage; costs use integer micro-CNY and round up only when converted to credits. Chat reserves a conservative request/output bound, requires final usage, and settles SSE usage at completion. Images reserve a bounded token budget and settle the provider's separate text, image and output tokens. Speech reserves text characters. Video submission reserves output duration, input-video allowance and extra reference images; an owned terminal task result settles the reservation. Missing usage retains the reservation for review. Underestimated bounds stop that service instead of silently charging more than reserved.

Count-priced Alibaba images and duration-priced recognition/video use the provider's final usage. Asynchronous submissions keep the reservation until an owned terminal job result arrives. Polling across the same provider key resolves the original service; it cannot read another user's job. Alibaba speech counts Han and Hangul characters twice, as specified by its pricing rules. Pending, failed and unknown results remain distinct, and an exact replay cannot refund or debit twice.

Definitive upstream rejection refunds once. Timeouts, connection loss and incomplete responses remain unknown. An administrator must check the provider before reconciling. A terminal reconciliation prevents later polling from refunding again. Request replay never re-executes an upstream job. Polling another account's job is forbidden even when the accounts share a provider key.

## Membership drafts

[OpenDesign's plans](https://open-design.ai/pricing/) informed the two-tier structure; its prices and credit bonuses are not copied.

| Disabled draft | Price / term | Included credits | Provider-cost budget |
| --- | --- | --- | --- |
| Standard | CNY 99 / 30 days | 40,000 | CNY 40 |
| Pro | CNY 299 / 30 days | 160,000 | CNY 160 |

Enabling or selling a plan checks its CNY income against credit cost, `PAYMENT_FEE_BPS` (default 5%), `MINIMUM_MARGIN_BPS` (30%) and `MEMBERSHIP_OPERATING_RESERVE_FEN` (CNY 30). Credit redemption cannot mint more credits than it consumes. These are configurable accounting guards, not a profitability guarantee: OSS storage, egress, support, taxes and actual payment fees must fit the remaining budget. Quotas do not allocate physical space, but selling a plan with large storage usage can exceed that allowance.

For the CNY 99 plan, 40,000 credits cap model costs at CNY 40. At the default policy, payment fees reserve CNY 4.95 and operations reserve CNY 30, leaving CNY 24.05. The allowed credit ceiling is 44,830. The administration editor calculates this from the deployed policy and rejects an enabled plan above its ceiling. This estimate excludes costs beyond the configured reserves.

Both plans and all official connections stay disabled until the operator supplies keys, tests real usage and payment settlement, reviews current prices and budgets OSS costs for the selected region. This release does not provide automatic renewal, paid storage upgrades or separate metered OSS-traffic charges. Administrators can adjust storage limits directly.

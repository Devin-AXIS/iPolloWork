# 官方模型长会话触发 SERVICE_INPUT_LIMIT 的故障记录

记录日期为 2026 年 11 月 19 日，时间采用 Asia/Shanghai。

## 现象与错误证据

用户在「医生工作台五阶段开发」会话中反复发送「继续」时失败。选择 iPolloWork 提供的 DeepSeek 模型会出现错误，直接使用自己的 DeepSeek Key 可以继续工作。

原设备的轨迹截图提供了以下信息。

| 字段 | 内容 |
| --- | --- |
| 请求 | 第 101 个请求，第 16 轮 |
| 提供方 | `ipollo-official-deepseek` |
| 模型 | `deepseek-flash` |
| 开始时间 | 2026-11-19 13:53:18.024 |
| 持续时间 | 1,001 毫秒 |
| 工具调用 | 0 |
| 客户端错误分类 | `INVALID_REQUEST` |
| 服务端返回 | HTTP 400，`SERVICE_INPUT_LIMIT` |

`INVALID_REQUEST` 是客户端对该 HTTP 400 的分类，服务端错误码揭示了输入预检拒绝的具体原因。

## 根因

账号服务 `services/ipollowork/src/pricing.ts` 的 `reserveUsage()` 在计费预检阶段计算整个请求 JSON 的 UTF-8 字节数，并使用下面的条件决定是否拒绝请求。

```ts
if (!multimodal && bytes + 2048 > rate.maxInputTokens)
  throw new ServiceError("SERVICE_INPUT_LIMIT", 400);
```

`bytes` 的单位是字节，`maxInputTokens` 的单位是 token。整个请求还包含 JSON 结构、历史消息、工具说明和工具结果。用两种单位直接比较，会把部分模型实际上能够接收的长请求提前拦截。中文字符通常占用多个 UTF-8 字节，也会受到这种判断的影响。

每次发送「继续」，客户端都会携带当前会话的历史，重复请求仍会触发同一条件。使用个人 DeepSeek Key 时，请求经过个人模型通道，由供应商判断实际上下文长度。

`services/ipollowork/src/execution.ts` 在创建调用记录和向供应商发送请求之前执行这项预检。本次 `SERVICE_INPUT_LIMIT` 拒绝发生在供应商调用和用量结算之前。

## 修复

UTF-8 字节数只用于保守估算计费成本，估算输入量以配置的输入 token 上限封顶。实际上下文是否可接收由供应商按其分词方式校验，最终费用使用供应商返回的实际用量结算。

```ts
const input = multimodal
  ? rate.maxInputTokens
  : Math.min(bytes + 2048, rate.maxInputTokens);
```

网关另行执行 HTTP 请求体大小和输出 token 限制。实际超出供应商上下文窗口的请求仍需通过会话压缩等方式减少输入。

回归测试位于 `services/ipollowork/tests/pricing.test.ts`，覆盖长代码、中文历史、较长工具说明，以及按实际 token 用量结算的情况。

## 验证记录

上线前通过 `cloud.ipollo.net` 的官方模型调用接口发送了 1,088,192 字节的合成长文本请求，收到 HTTP 400 和 `SERVICE_INPUT_LIMIT`。该请求采用人工合成文本进行验证。

针对性的三种长输入场景已通过回归。服务端检查通过 95 项测试，构建通过，仓库的 11 项测试和上游校验通过。

上线后通过同一官方模型接口发送 1,088,178 字节的合成长请求，返回 HTTP 200，模型回复 `OK`。供应商报告 `prompt_tokens=340014`、`completion_tokens=1`。这说明超过一百万字节的请求可以处于该模型的上下文范围内。

上线后请求 ID 为 `8aa1e879-f025-467f-afef-f7214643efab`。公网健康检查通过。

## 部署记录

目标服务为 `cloud.ipollo.net`，阿里云华南 2（河源）实例 `ipollowork-prod-cn-01`。

部署前核对到的镜像为 `ipollowork-work:0.1.13-4f720e4c65`，源码提交为 `4f720e4c65842a1824c897865148e4f4fc6b1eb5`。容器处于运行状态，重启次数为 0。检查确认生产镜像包含旧的字节数拒绝条件。

修复镜像为 `ipollowork-work:0.1.13-input-limit`，源码提交为 `4965db1034d766a0ed5817e08554e8cd6bb363e0`。上线模块与本地构建一致，SHA-256 为 `6dd55f2e0bfc4a8cbda10a684daabca64db48802b6e7bdd3928942fec90f23f8`。

上线时间为 2026-11-19 14:40。数据库、认证密钥和服务配置备份保存在 `/opt/ipollowork/releases/20261119-input-limit/backup`。上线校验确认认证密钥与备份一致。

部署过程中，首次命令没有限定 `work` 服务，导致入口容器被重建，并加载了缺少 `cloud.ipollo.net` 的磁盘配置，约在 14:33 至 14:38 出现 HTTPS 中断。已从现有入口备份恢复域名和官网路由，随后只更新账号服务。`cloud.ipollo.net` 和 `work.ipollo.net` 均返回 200。

## 原会话复验范围

neil 的 Mac 上保留着原始会话。本次使用合成长输入验证官方模型网关。原设备上的第 16 轮及后续工作，需要在上线后重新发送任务验证。

共享到另一台设备的会话只包含文字快照，原始模型请求及错误详情需要在原设备的「轨迹」中查看。导入历史时显示的「已完成，用时 1 秒」不能作为原请求成功的依据。

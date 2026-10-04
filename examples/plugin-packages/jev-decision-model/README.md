# Jev DSH 决策引擎

[![iPolloWork Plugin](https://img.shields.io/badge/iPolloWork_Plugin-import-334155)](#安装到-ipollowork)
[![DeepSeek Harness Plugin](https://img.shields.io/badge/DeepSeek_Harness_Plugin-native-2563eb)](#安装到-deepseek-harness)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode_Plugin-via_Work-475569)](#支持与接入方式)
[![Codex Harness Plugin](https://img.shields.io/badge/Codex_Harness_Plugin-via_Work-475569)](#支持与接入方式)

**为 Agent Harness 提供结构化决策能力。**

将 TypeSafe AI 的 Jev 决策能力接入你的 Agent：帮助选择工具、Skill 和任务负责人，评估产出质量，并以结构化结果返回判断与概率。Jev 负责辅助决策，原 Agent 继续负责规划和执行。

提供 **DeepSeek Harness 原生插件**和 **iPolloWork 导入插件**两个安装入口；在 iPolloWork 中可供 **OpenCode、DeepSeek Harness、Codex Harness** 使用。同一份决策核心，不修改引擎源码，不接管主 Agent。

<img src="assets/jev.png" width="64" alt="Jev / TypeSafe AI" />

**快速开始：**[安装到 DeepSeek Harness](#安装到-deepseek-harness) · [安装到 iPolloWork](#安装到-ipollowork)

## 支持与接入方式

| 使用环境 | 接入方式 | 安装入口 |
| --- | --- | --- |
| DeepSeek Harness（DSH） | 原生插件，独立运行，不依赖 iPolloWork | DSH 插件命令 |
| iPolloWork | 独立导入、授权、启停与卸载 | 扩展 → 导入插件包 |
| OpenCode | 通过 iPolloWork 的扩展接口使用 Jev | 在 iPolloWork 安装一次 |
| Codex Harness | 通过 iPolloWork 的扩展接口使用 Jev | 在 iPolloWork 安装一次 |

OpenCode 和 Codex Harness 当前支持的是 **iPolloWork 内的接入方式**，本仓库尚未提供它们各自的独立原生安装包。其他 Harness 可以基于共享决策核心开发适配器，不代表已经自动兼容。

## 核心能力

- 根据任务，在**当前真实可用且获准使用**的工具、Skill、Agent 之间推荐选择。
- 按明确标准评分、判断是否需要某项能力；独立问题可以一次批量评估。
- 返回选择、概率、置信度与用量；**不执行推荐动作，也不自动切换模型或路由所有请求**。
- 提供本地配置检查和真实连接测试。连接测试会产生少量 TypeSafe API 用量。

Jev 是 TypeSafe AI 的结构化决策模型，不是聊天模型。原 Agent 继续负责规划、解释、参数构造、工具执行和原生子 Agent 协作。Jev 不返回文字推理过程，Agent 的解释不能冒充 Jev 的原始输出。

## 安装到 DeepSeek Harness

适合直接使用 DSH 的用户。**无需安装或运行 iPolloWork。**

### 1. 安装插件

已安装 DSH 后，克隆本仓库，通过本地绝对路径安装：

```sh
git clone https://github.com/Devin-AXIS/jev-dsh-decision.git
dsh plugin add /absolute/path/jev-dsh-decision
```

把 `/absolute/path/jev-dsh-decision` 替换成克隆目录的实际绝对路径。插件使用原生 `dsh.bundle` 格式，无需构建源码。

如果已经拿到 `.tgz` 安装包，也可以直接安装：

```sh
dsh plugin add /absolute/path/dsh-jev-decision-model-0.1.2.tgz
```

### 2. 配置授权

在 DSH 的凭据管理或启动环境中配置自己的 **`TYPESAFE_API_KEY`**。不要把密钥写进插件源码或聊天记录。插件复用 DSH 的 `credentials`、`tools` 和 `skills` 服务；官方默认配置提供这些服务，自定义配置需要保留它们。

### 3. 验证并使用

重启运行中的 DSH 会话，让新配置生效，然后在对话中说：

> 使用 Jev，先检查配置，再测试连接。

插件提供 `jev_status`（本地状态）、`jev_check_connection`（真实连接测试）、`jev_evaluate`（结构化评估）三个工具，以及 `jev-decision` Skill。连接测试会产生少量 TypeSafe API 用量；本地显示“已配置”不代表密钥已经验证。

### 卸载

```sh
dsh plugin remove dsh-jev-decision-model
```

DSH 凭据由宿主统一持有，插件卸载不会擅自删除可能被其他插件共用的 `TYPESAFE_API_KEY`；不再需要时请在 DSH 凭据管理或环境中移除。运行中的 DSH 会话应重启以加载新的插件配置。

## 安装到 iPolloWork

适合使用 Work 图形界面的用户。**在 Work 中安装一次，供其支持的 OpenCode、DeepSeek Harness、Codex Harness 引擎使用，无需分别安装三个包。**

### 1. 导入安装包

获取已签名的 `jev-decision-model-0.1.2.ipollowork-plugin` 安装包，在 **扩展 → 导入插件包** 中选择它，确认发布者为 **iPolloWork**。维护者的安装包构建方式见下方“开发和测试”。

已安装旧版时，导入新版可沿用原插件身份升级。显示名称为“Jev DSH 决策引擎”，内部插件 ID `jev-decision-model` 和 DSH 包名 `dsh-jev-decision-model` 保持不变。

**客户端要求：**需要包含 `ipollowork/ipollowork-2026` 官方签名公钥注册的 Work 版本。未包含此注册的旧客户端会拒绝导入；仅满足清单里的最低版本号不够。请勿绕过签名校验。

### 2. 配置授权

打开插件详情中的授权入口，填写自己的 **TypeSafe API Key**。密钥由 Work 的插件授权仓库保存，不需要发给对话中的 Agent。

### 3. 验证并使用

在对话中启用“Jev DSH 决策引擎”，然后说：

> 使用 Jev，先检查配置，再测试连接。连接成功后，帮我选择适合当前任务的 Skill。

Work 提供 `status`、`check-connection`、`evaluate` 三个动作，由现有扩展接口调用。这里的“测试连接”会发出一个真实且有少量用量的请求。

### 卸载

在 **扩展 → Jev DSH 决策引擎 → 卸载** 中移除。Skill、插件内容和专属授权由 Work 随包清理，没有另装全局脚本或后台守护进程；卸载不会删除 TypeSafe 云端账户。

## 对话示例

- “用 Jev 判断这项任务需要哪些已安装的 Skill，再由你执行。”
- “从当前可用的 Agent 中，选出最适合负责竞品分析的一个。”
- “按准确性、完整性和清晰度评估这份结果；不确定的部分交给我确认。”

推荐结果不等于执行授权。需要外部操作时，仍遵循当前 Harness 的权限和确认流程。

<details>
<summary>开发者参考：调用格式、签名与测试</summary>

## 调用格式

`evaluate` 与 `jev_evaluate` 使用相同参数：

```json
{
  "state": { "task": "为已收集的竞品资料制作汇报", "available": ["research", "slides"] },
  "questions": {
    "owner": {
      "type": "choice",
      "instructions": "哪个已提供的 Agent 最适合负责最终交付？",
      "criteria": { "research": "负责资料分析", "slides": "负责演示文稿" }
    },
    "need_review": { "type": "noul", "instructions": "这个任务是否需要审稿？" },
    "clarity": { "type": "score", "instructions": "任务要求是否清楚？", "criteria": ["不明确", "部分明确", "明确"] }
  }
}
```

问题类型是 `choice`（单选）、`score`（等级评分）、`noul`（是的概率）。多个互补 Skill 可使用多个独立 `noul` 问题。传入最小必要上下文，不传密钥或无关私密资料。网络固定发往 `https://api.typesafe.ai/v1/systemone`；默认模型 `jev-latest`。

插件限制每次 64 个问题、256 KiB 请求、1 MiB 响应、20 秒总网络时限；仅对 429/529 最多重试两次。没有无限重试、后台自动学习或全局请求拦截。错误会脱敏，不返回上游错误正文。

## 开发和测试

Node >=20.11，pnpm；运行时零第三方依赖。JSZip 仅用于开发时构建 Work 包。

```sh
pnpm install --frozen-lockfile
pnpm test
DSH_RUNTIME_ROOT=/path/to/dsh-runtime pnpm test:dsh
pnpm package:dsh
DSH_RUNTIME_ROOT=/path/to/dsh-runtime DSH_CLI_TEST=1 pnpm test:dsh
```

Work 包使用宿主要求的 Ed25519 签名格式。私钥放在仓库之外，不随源码、安装包或发布附件分发：

```sh
IPOLLOWORK_PLUGIN_SIGNING_KEY=/secure/path/ipollowork-ed25519.pem \
IPOLLOWORK_PLUGIN_KEY_ID=ipollowork-2026 pnpm package:work
IPOLLOWORK_ROOT=/path/to/updated/iPolloWork pnpm test:work
pnpm package:dsh
```

签名标识为 `ipollowork/ipollowork-2026`，公钥（SPKI DER，Base64）：

```text
MCowBQYDK2VwAyEAoHA9xxXNZPQ7y+AKpDBIXruNvwVasq7axjilzIY6RDE=
```

Work 集成测试使用真实宿主 API，在独立临时目录测试签名、图标、导入、授权轮换、服务调用、卸载及篡改拒绝。TypeSafe 响应使用明确的测试数据，不代表真实 API 密钥已验证。DSH 测试使用真实工具与 Skill 注册表，检查加载和卸载。

</details>

## 来源与标识

- [TypeSafe AI 官方 API 文档](https://docs.typesafe.ai/api)
- [DSH 官方插件开发文档](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/develop)
- 图标原样取自 [TypeSafe 官方文档的黑色透明底图标](https://docs.typesafe.ai/mintlify-assets/_mintlify/favicons/ts-docs/zg2v0DiYB7xPw0I2/_generated/favicon/android-chrome-192x192.png)，安装包内嵌以便离线显示，未使用粉色版本。图标及品牌权利归原权利人所有。

本项目由 **iPolloWork** 维护和发布。Jev 属于 TypeSafe AI；本项目不表示获得 TypeSafe AI、DeepSeek 或其他 Harness 项目的官方背书。

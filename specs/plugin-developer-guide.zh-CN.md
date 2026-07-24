# Specification: iPolloWork 插件开发、打包与发布完整指南

## Metadata

- **Version**: 1.0.0
- **Status**: Realized
- **Author**: Codex
- **Created**: 2026-07-21
- **Last Updated**: 2026-07-21

## Overview

本文是 iPolloWork 独立插件包的完整开发契约，适用于插件开发者、内部审核人员和未来插件平台的实现者。它说明开发插件是否需要框架、目录如何组织、清单如何声明、Skill、OpenCode 插件、MCP、本地服务和授权如何组合，以及当前如何本地安装、以后如何上传和发布。

先给出最重要的结论：

1. **不强制使用 React、Next.js 或某个专用 SDK。** iPolloWork 插件首先是一份目录约定和 `ipollowork.plugin.json` 清单协议。
2. **推荐使用 TypeScript，但开发者可以在外部使用任何构建工具。** 当前插件管理器不会替开发者执行 `npm install`、`pnpm install`、编译或构建脚本。
3. **发布物必须是自包含产物。** 运行所需的每个文件都必须在 `resources` 中声明。最好把第三方依赖预先 bundle 到单文件中。
4. **一个插件可以组合多个能力。** Skill 负责告诉 AI 何时使用；MCP 或本地服务负责实际能力；授权由插件自己的加密授权存储负责；OpenCode 插件负责需要运行时钩子的高级扩展。
5. **普通用户不需要理解这些组件。** 用户只看到安装、连接、使用、更新和卸载。Skill 不应要求用户在聊天中粘贴 Key。
6. **当前可用的安装格式是“工作区内的解压目录”。** 当前版本尚未实现商城 ZIP 上传接口。未来上传格式应以本文定义的同一目录为 ZIP 根目录，不引入第二套插件格式。

### 插件各层的关系

```text
用户请求
   │
   ▼
Skill：判断何时用、如何组织调用和结果
   │
   ├──────────────► MCP：标准远程或本地工具服务
   │
   └──────────────► local-service：插件自带的本地动作
                            │
                            ▼
                     插件独立授权存储
                     Key / OAuth / 设备码 / 托管跳转

OpenCode plugin：可选的运行时钩子和更底层扩展
```

### 应该选择哪种组成方式

| 需求 | 推荐组成 | 说明 |
|---|---|---|
| 只想教 AI 一套固定流程 | Skill + 最小 OpenCode 入口 | 当前安装包至少要有一个 `opencode` 或 `service` 入口 |
| 接入已有 MCP 服务 | Skill + MCP + 最小 OpenCode 入口 | MCP 配置由安装器注册，Skill 负责让 AI 正确使用 |
| 调用带 API Key 的 REST 服务 | Skill + local-service + `secret-form` | Key 只进入本地服务，不进入聊天和 Skill |
| 接入 OAuth SaaS | Skill + local-service + `oauth-pkce` 或 `hosted-browser` | 登录一次后持久化；支持自动刷新令牌 |
| 需要扫码或电视设备码 | Skill + local-service + `device-code` | 平台负责显示验证码、轮询和保存令牌 |
| 需要 OpenCode 生命周期钩子 | OpenCode plugin，可再组合 Skill/MCP/service | 这是高级能力，不应只为了占位而加入复杂逻辑 |
| 需要完整产品级插件 | Skill + service/MCP + authorization，可选 OpenCode plugin | 用户仍只看到一个插件 |

## Requirements

### Functional Requirements

- FR-1: 每个可安装插件目录必须在根目录包含 `ipollowork.plugin.json`。
- FR-2: 每个安装包必须声明稳定插件 ID、语义版本、更新 ID 和至少一个运行入口。
- FR-3: 所有会被安装、加载或校验的文件必须通过 `resources[].path` 显式声明。
- FR-4: Skill、服务、动作和授权之间的依赖必须通过 `requires` 与 `provides` 声明，不能只写在自然语言说明里。
- FR-5: 插件凭据必须使用插件独立授权能力，不得依赖 Authorization Center 或全局环境变量 Key。
- FR-6: 本地服务必须只返回业务结果，不得返回、记录或拼接原始凭据。
- FR-7: 同一插件 ID 的新发布必须提高版本号；已发布版本内容不可变。
- FR-8: 安装、更新和卸载必须保留非插件拥有的工作区文件。
- FR-9: 上传前必须完成清单校验、资源存在性校验、兼容性校验和完整性校验。
- FR-10: 插件说明必须让普通用户通过“安装 → 连接 → 使用”完成操作，不要求理解 Skill、MCP 或服务内部结构。

### Non-functional Requirements

- NFR-1: 插件包应保持轻量、自包含，并优先复用 OpenCode 原生插件、Skill 和 MCP 机制。
- NFR-2: 第三方插件默认必须声明 `trusted: false`。
- NFR-3: 除 localhost 开发地址外，授权端点必须使用 HTTPS。
- NFR-4: 开发者不得把客户端密钥、API Key、刷新令牌或私钥写进插件包。
- NFR-5: 插件服务应支持长期复用，并在更新、停用、重新授权、卸载和应用退出时正确释放资源。
- NFR-6: 插件应兼容声明的 iPolloWork 和 OpenCode 版本范围。
- NFR-7: 插件动作输入应使用明确、收敛的 JSON Schema，拒绝不必要的附加字段。
- NFR-8: 原生 OpenCode 插件和本地服务运行在本机进程环境中；当前隔离是存储和 API 边界，不是恶意代码硬沙箱。

## 1. 开发框架与工具链

### 1.1 是否需要框架

不需要专用 UI 框架，也不需要从某个 iPolloWork SDK 项目开始。插件的“框架”就是以下三个稳定契约：

- 根目录清单：`ipollowork.plugin.json`
- OpenCode 兼容资源：Skill、MCP、OpenCode plugin 等
- iPolloWork 本地服务接口：默认导出一个服务工厂，并声明可调用动作

如果插件没有界面，完全不需要 React 或 Next.js。如果供应商本身有 OAuth 网页、管理后台或托管授权页，可以继续使用供应商自己的 Next.js、Vue、Go 或其他服务；它位于供应商服务器，不需要塞进插件包。

### 1.2 推荐开发技术

- 清单：UTF-8 JSON
- Skill：Markdown + YAML frontmatter
- OpenCode plugin：TypeScript ESM
- local-service：TypeScript ESM
- MCP 配置：UTF-8 JSON
- 外部构建：可用 `tsup`、`esbuild`、Rollup、Vite 或开发者自己的工具

### 1.3 当前插件管理器不会做什么

当前安装器不会：

- 执行 `npm install`、`pnpm install` 或 `bun install`
- 执行 `postinstall`、构建脚本或任意 shell 脚本
- 自动递归复制整个目录
- 自动发现未在清单中声明的相对依赖
- 自动创建供应商 OAuth Client
- 自动上传插件到云端商城

因此，开发时可以使用任意框架，发布时必须输出可直接运行的自包含文件。最稳妥的方式是把 service 和 OpenCode plugin 分别打成单文件；如确实要保留多个文件，每个文件都要在 `resources` 中声明。

## 2. 包格式与目录结构

### 2.1 当前实际支持的格式

当前版本安装的是一个**已经解压、位于选中工作区内部的目录**。例如：

```text
my-workspace/
└── plugins/
    └── acme-research/
        └── ipollowork.plugin.json
```

设置页中填写的路径是相对工作区路径：

```text
plugins/acme-research
```

绝对路径、`../` 穿越路径以及工作区外目录会被拒绝。

### 2.2 未来商城上传格式

当前没有已经上线的 ZIP 上传接口。未来开发者平台应接受 ZIP，并遵守以下契约：

```text
acme-research-1.0.0.zip
├── ipollowork.plugin.json   ← 必须直接位于压缩包根目录
├── service/
└── .opencode/
```

不要在 ZIP 里再包一层无意义目录，例如下面这种结构不应作为标准上传物：

```text
acme-research-1.0.0.zip
└── acme-research-1.0.0/
    └── ipollowork.plugin.json
```

未来平台可以在接收 ZIP 后解压到临时目录，再调用现有的校验和安装生命周期。ZIP 只是传输容器，内部仍是本文定义的插件包。

### 2.3 推荐完整目录

```text
acme-research/
├── ipollowork.plugin.json
├── README.md                         # 给审核者和开发者，可选
├── CHANGELOG.md                      # 发布说明，可选
├── assets/
│   └── icon.svg                      # 如清单声明了它，才会进入安装资源
├── service/
│   └── acme-research.ts              # 本地业务服务，可选
└── .opencode/
    ├── plugins/
    │   └── acme-research.ts          # OpenCode 插件入口，可选
    ├── skills/
    │   └── acme-research/
    │       └── SKILL.md               # AI 使用说明，可选但强烈推荐
    └── mcps/
        └── acme-research.json         # MCP 配置，可选
```

### 2.4 最小可安装目录

由于当前 `package.entrypoints` 至少要求 `opencode` 或 `service` 之一，纯 Skill 插件也需要一个最小 OpenCode 入口：

```text
hello-plugin/
├── ipollowork.plugin.json
└── .opencode/
    ├── plugins/hello-plugin.ts
    └── skills/hello-plugin/SKILL.md
```

最小入口可以是：

```ts
export default async function helloPlugin() {
  return {};
}
```

## 3. 命名规则

### 3.1 插件 ID

推荐格式：

```text
acme-research
acme.storage
team_tool
```

规则：

- 只使用小写字母、数字、点、下划线或连字符
- 必须以字母或数字开头和结尾
- 发布后保持稳定，不随显示名称变化
- 以下 ID 由内置扩展保留，第三方包不能使用：`google-workspace`、`media-center`、`openai-image-generation`、`storage`

### 3.2 资源和授权方法 ID

资源 ID 在同一清单内必须唯一；授权方法 ID 在同一清单内必须唯一。为了能被关系引用，应采用与插件 ID 相同的简单格式。

推荐把不同概念写清楚：

```text
插件：acme-research
Skill：research-workflow
服务：acme-service
动作：search
授权：api-key
```

### 3.3 `updateId`

`updateId` 用于跨版本识别同一发布通道，推荐使用：

```text
publisher-id/plugin-id
```

例如：

```text
acme/acme-research
```

更新时 `id` 和 `updateId` 都不应改变。

## 4. 清单总览

一个完整清单如下：

```json
{
  "schemaVersion": 1,
  "id": "acme-research",
  "name": "Acme Research",
  "description": "Search Acme private research.",
  "source": {
    "format": "ipollowork-extension-manifest",
    "origin": "local",
    "trusted": false
  },
  "package": {
    "version": "1.0.0",
    "publisher": {
      "id": "acme",
      "name": "Acme"
    },
    "compatibility": {
      "ipollowork": ">=0.17.0",
      "opencode": ">=1.18.0"
    },
    "updateId": "acme/acme-research",
    "entrypoints": {
      "opencode": ".opencode/plugins/acme-research.ts",
      "service": "service/acme-research.ts"
    }
  },
  "permissions": [
    {
      "id": "network",
      "reason": "Connect to the Acme research API."
    }
  ],
  "authorization": {
    "required": true,
    "methods": [
      {
        "id": "api-key",
        "kind": "secret-form",
        "label": "API key",
        "description": "Create a key in your Acme account.",
        "fields": [
          {
            "id": "apiKey",
            "label": "API key",
            "placeholder": "acme_…",
            "secret": true,
            "required": true
          }
        ]
      }
    ]
  },
  "resources": [
    {
      "type": "opencode-plugin",
      "id": "acme-runtime",
      "label": "Acme OpenCode integration",
      "path": ".opencode/plugins/acme-research.ts",
      "required": true
    },
    {
      "type": "skill",
      "id": "research-workflow",
      "label": "Acme research workflow",
      "path": ".opencode/skills/acme-research/SKILL.md",
      "requires": [
        "service:acme-service",
        "authorization:api-key"
      ],
      "provides": [
        "workflow:research"
      ],
      "required": true
    },
    {
      "type": "local-service",
      "id": "acme-service",
      "label": "Acme local service",
      "path": "service/acme-research.ts",
      "requires": [
        "authorization:api-key"
      ],
      "provides": [
        "action:search"
      ],
      "actions": [
        {
          "id": "search",
          "title": "Search Acme research",
          "description": "Search the connected private research library.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "query": {
                "type": "string",
                "description": "Research query."
              }
            },
            "required": ["query"],
            "additionalProperties": false
          }
        }
      ],
      "required": true
    }
  ]
}
```

## 5. 清单字段参考

### 5.1 根字段

| 字段 | 必填 | 类型 | 说明 |
|---|---:|---|---|
| `schemaVersion` | 是 | `1` | 当前固定为 1 |
| `id` | 是 | string | 稳定插件 ID |
| `name` | 是 | string | 用户看到的名称 |
| `description` | 是 | string | 用户和审核者看到的说明，可为空字符串但不推荐 |
| `source` | 是 | object | 来源和信任信息 |
| `package` | 安装时是 | object | 版本、兼容性、入口和完整性 |
| `permissions` | 否 | array | 权限用途声明 |
| `authorization` | 否 | object | 插件独立授权方法 |
| `resources` | 是 | array | 插件拥有的组件和文件 |
| `icon` | 否 | object | 图标元数据 |
| `platform` | 否 | array | `darwin`、`linux`、`windows`、`web` |
| `composer` | 否 | object | 现有扩展兼容字段 |
| `setup`、`contributions`、`lifecycle`、`enablement` | 否 | object/array | 现有扩展兼容字段；第三方开发者不应依赖未文档化行为 |
| `defaultEnabled`、`defaultHidden`、`preview` | 否 | boolean | 现有扩展兼容元数据 |

### 5.2 `source`

第三方本地插件推荐固定写法：

```json
{
  "format": "ipollowork-extension-manifest",
  "origin": "local",
  "trusted": false
}
```

未来从官方插件平台安装时，平台可以把 `origin` 设为 `den` 并加入 `reference`。开发者不得自行把未经审核的包标记为可信包。

支持的 `format` 值包括：

- `ipollowork-builtin`
- `ipollowork-extension-manifest`
- `claude-plugin`
- `opencode-plugin`
- `mcp-directory`
- `manual`

新开发的完整 iPolloWork 插件应优先使用 `ipollowork-extension-manifest`。

### 5.3 `package`

| 字段 | 必填 | 说明 |
|---|---:|---|
| `version` | 是 | 严格语义版本，例如 `1.0.0`、`1.1.0-beta.1` |
| `publisher.id` | 否但推荐 | 稳定发布者 ID |
| `publisher.name` | 与 publisher 同时 | 用户看到的发布者名 |
| `compatibility.ipollowork` | 否但推荐 | iPolloWork 版本范围 |
| `compatibility.opencode` | 否但推荐 | OpenCode 版本范围 |
| `updateId` | 是 | 同一插件跨版本的更新标识 |
| `entrypoints.opencode` | 二选一 | 必须对应一个 `opencode-plugin` 资源路径 |
| `entrypoints.service` | 二选一 | 必须对应一个含动作声明的 `local-service` 资源路径 |
| `checksum` | 否 | `{ "algorithm": "sha256", "value": "64位十六进制" }` |

`entrypoints` 至少需要一个入口。可以同时声明两个。

当前兼容范围支持：

- `*`
- 精确版本：`1.2.3`
- 比较：`>=1.2.3`、`<2.0.0`
- 兼容范围：`^1.2.3`、`~1.2.3`
- 一个 OR：`^1.2.3 || ^2.0.0`
- 闭区间：`1.2.3 - 1.9.0`

### 5.4 `permissions`

支持的权限 ID：

| ID | 用途示例 |
|---|---|
| `network` | 调用供应商 API、远程 MCP |
| `workspace-read` | 读取用户工作区文件 |
| `workspace-write` | 创建或修改工作区文件 |
| `process` | 启动本地进程或子进程 |
| `clipboard` | 读取或写入剪贴板 |
| `notifications` | 发送桌面通知 |
| `camera` | 使用摄像头 |
| `microphone` | 使用麦克风 |

声明示例：

```json
{
  "id": "workspace-read",
  "reason": "Read the document selected by the user.",
  "optional": false
}
```

每项必须说明具体原因。当前权限字段用于安装预览、审核和未来策略执行；它不是恶意原生代码的硬沙箱。不得因为当前尚未强制阻止，就省略真实权限。

### 5.5 `resources`

每个资源都可以包含：

| 字段 | 说明 |
|---|---|
| `type` | 资源类型 |
| `id` | 清单内唯一 ID |
| `label` | 用户可读名称 |
| `description` | 说明 |
| `path` | 相对插件根目录的安全路径 |
| `required` | 是否属于插件核心能力 |
| `requires` | 此资源依赖的组件 |
| `provides` | 此资源提供的能力 |

当前一等支持并经过插件生命周期测试的类型：

| 类型 | 用途 | 安装行为 |
|---|---|---|
| `skill` | AI 使用规则 | 文件复制到声明路径，通常放在 `.opencode/skills/` |
| `opencode-plugin` | OpenCode 运行时入口 | 入口被注册为 `file://` 插件 |
| `mcp` | MCP 配置 | 解析 JSON 并注册/停用/卸载 |
| `local-service` | 凭据感知的本地动作 | 从不可变版本快照动态加载 |
| `file` | 额外运行文件或资源 | 复制并纳入所有权与校验 |

清单还接受 `agent`、`command`、`tool`、`provider`、`hook`、`context`、`secret` 和 `native-binary` 等现有扩展资源类型。除非对应加载行为已经在目标版本中明确验证，否则第三方开发者应把它们视为高级兼容类型，不应假设清单会自动执行或注册任意文件。

只有 `resources[].path` 指向的文件会被资源校验、哈希、快照和复制。声明目录不会自动递归包含内部文件。

### 5.6 关系声明

支持的关系：

```text
service:<local-service-resource-id>
resource:<resource-id>
authorization:<authorization-method-id>
action:<service-action-id>
workflow:<workflow-id>
```

例如：

```json
{
  "type": "skill",
  "id": "research-workflow",
  "requires": [
    "service:acme-service",
    "authorization:api-key"
  ],
  "provides": [
    "workflow:research"
  ]
}
```

```json
{
  "type": "local-service",
  "id": "acme-service",
  "requires": [
    "authorization:api-key"
  ],
  "provides": [
    "action:search"
  ]
}
```

重要语义：

- 同一资源中的多个 `requires` 是 **AND**，必须全部满足。
- `authorization:api-key` 与 `authorization:oauth` 同时出现，表示两种授权都要连接，不表示任选一种。
- 如果插件提供 API Key/OAuth 二选一，应使用 `authorization.required: true`，不要把两个方法同时写成资源硬依赖；服务中依次读取可用方法。
- `service:` 必须指向 `local-service`。
- `action:` 的 `provides` 必须与同一服务的 `actions[].id` 对应。
- 重复关系、未知授权、未知资源、未知服务和未声明动作会在校验阶段失败。

## 6. Skill 开发

### 6.1 Skill 的职责

Skill 只负责：

- 说明什么用户意图应该触发插件
- 说明调用哪个动作或 MCP 工具
- 说明参数如何组织
- 说明结果如何解释、引用或写入文件
- 说明授权缺失时引导用户去设置页连接

Skill 不负责：

- 保存 Key
- 读取环境变量
- 启动长期后台服务
- 每次执行时安装依赖
- 要求用户在聊天中粘贴秘密

### 6.2 推荐 Skill 模板

```markdown
---
name: acme-research
description: Search and summarize material from the Acme research service.
---

# Acme research

Use this plugin when the user asks to search the Acme private research library.

1. Call `ipollowork_extension_call` with:
   - `extensionId`: `acme-research`
   - `action`: `search`
   - `args`: `{ "query": "..." }`
2. Summarize returned records and cite their source URLs.
3. If the platform reports `plugin_authorization_required`, ask the user to open Settings → Extensions and connect Acme Research.
4. Never ask the user to paste a key into chat.
5. Never expose or summarize authorization values.
```

Skill 路径推荐为：

```text
.opencode/skills/<skill-name>/SKILL.md
```

## 7. local-service 开发

### 7.1 服务接口

服务入口必须默认导出工厂函数：

```ts
type AuthorizationRuntime = {
  listConnections(): Promise<Array<{
    accountId: string;
    methodId: string;
    status: string;
  }>>;
  getCredential(
    methodId: string,
    accountId?: string,
  ): Promise<Readonly<Record<string, string>> | null>;
  readCredential(
    accountId: string,
    methodId: string,
  ): Promise<Readonly<Record<string, string>> | null>;
  setActiveAccount(
    methodId: string,
    accountId: string,
  ): Promise<boolean>;
};

type PluginRuntime = {
  plugin: Readonly<{
    id: string;
    version: string;
  }>;
  authorization: AuthorizationRuntime;
};

export default async function createService(runtime: PluginRuntime) {
  return {
    actions: {
      search: async (
        args: Record<string, unknown>,
        context: Record<string, unknown>,
      ) => {
        return { args, context };
      },
    },
    dispose: async () => {
      // Close sockets, timers, clients, or temporary resources.
    },
  };
}
```

### 7.2 带 API Key 的完整动作

```ts
export default async function createService(runtime: PluginRuntime) {
  const controller = new AbortController();

  return {
    actions: {
      search: async (args: Record<string, unknown>) => {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) throw new Error("query is required");

        const credential = await runtime.authorization.getCredential("api-key");
        if (!credential?.apiKey) {
          throw new Error("Connect Acme Research in Settings → Extensions");
        }

        const response = await fetch("https://api.acme.example/v1/search", {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Acme search failed with HTTP ${response.status}`);
        }

        return response.json();
      },
    },
    dispose: () => controller.abort(),
  };
}
```

### 7.3 服务生命周期

- 服务按 `workspace + plugin id + version` 延迟创建。
- 同版本后续调用复用同一个实例。
- 并发首次调用只创建一次。
- 初始化失败不会永久缓存失败实例，下次可重新尝试。
- 更新、回滚、停用、重新保存授权、OAuth 回调完成、设备授权完成、撤销授权、卸载和服务器退出都会释放相关服务。
- `dispose()` 应关闭长连接、计时器、监听器、临时客户端和其他资源。

不要在每个动作中启动新的常驻终端或守护进程。需要连接池或 SDK Client 时，在服务工厂中创建并复用。

### 7.4 动作声明必须与实现一致

清单：

```json
{
  "actions": [
    {
      "id": "search",
      "title": "Search Acme",
      "description": "Search Acme private research.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
        },
        "required": ["query"],
        "additionalProperties": false
      }
    }
  ]
}
```

服务：

```ts
return {
  actions: {
    search: async (args) => {
      // The key must exactly match actions[].id.
    },
  },
};
```

清单声明但服务没有实现的动作会在调用时失败。服务实现但清单没有声明的动作不会被公开调用。

### 7.5 服务安全规则

- 不要把 `credential` 放进动作返回值。
- 不要 `console.log(credential)`。
- 不要把供应商原始认证错误正文直接返回给 AI。
- 不要允许动作参数覆盖供应商 API Host，除非已做严格白名单。
- 对工作区路径做范围校验，不接受任意绝对路径。
- 对网络响应设置大小、超时和类型限制。
- 对写操作明确声明 `workspace-write`。

## 8. OpenCode plugin 开发

OpenCode plugin 是可选高级入口。它适用于工具钩子、聊天参数调整或 OpenCode 插件 API 提供的能力。

最小入口：

```ts
export default async function acmeResearchPlugin() {
  return {};
}
```

带钩子的示意：

```ts
export default async function acmeResearchPlugin() {
  return {
    "tool.execute.before": async () => {
      // Keep hooks lightweight and side-effect conscious.
    },
  };
}
```

入口必须同时满足：

1. `package.entrypoints.opencode` 指向该文件。
2. `resources` 中存在 `type: "opencode-plugin"` 且 `path` 完全相同的资源。

OpenCode plugin 与其他原生插件共享本机运行环境。第三方插件必须被视为可执行代码进行审核。

## 9. MCP 开发

### 9.1 单 MCP 配置

文件 `.opencode/mcps/acme-research.json`：

```json
{
  "type": "remote",
  "url": "https://mcp.acme.example/mcp"
}
```

清单资源：

```json
{
  "type": "mcp",
  "id": "acme-mcp",
  "label": "Acme MCP",
  "mcpServerName": "acme-research",
  "path": ".opencode/mcps/acme-research.json",
  "required": true
}
```

### 9.2 多 MCP 配置

配置文件也可以包含 `mcpServers` 或 `mcp` 对象：

```json
{
  "mcpServers": {
    "acme-search": {
      "type": "remote",
      "url": "https://mcp.acme.example/search"
    },
    "acme-files": {
      "type": "remote",
      "url": "https://mcp.acme.example/files"
    }
  }
}
```

安装、停用、启用和卸载插件时，这些 MCP 项会跟随插件生命周期变化。

不要把静态 Bearer Token 写进 MCP JSON。需要用户授权时，优先使用 MCP 自身标准 OAuth；需要由 iPolloWork 插件授权统一管理时，通过 local-service 调用供应商 API。

## 10. 授权开发

### 10.1 授权存储模型

授权按以下维度隔离：

```text
workspace installation + plugin id + account id + method id
```

凭据使用 AES-256-GCM 加密保存。设置页和公开状态 API 只返回字段是否存在、连接状态和更新时间，不返回原始值。第一个成功保存的账户会成为该授权方法的活动账户；活动账户选择会持久化。

### 10.2 API Key / Secret Form

```json
{
  "authorization": {
    "required": true,
    "methods": [
      {
        "id": "api-key",
        "kind": "secret-form",
        "label": "API key",
        "description": "Create a key in Acme developer settings.",
        "fields": [
          {
            "id": "apiKey",
            "label": "API key",
            "placeholder": "acme_…",
            "secret": true,
            "required": true
          },
          {
            "id": "region",
            "label": "Region",
            "secret": false,
            "required": false
          }
        ]
      }
    ]
  }
}
```

字段 ID 必须以字母开头，可包含字母、数字、点、下划线和连字符。服务中使用同一个字段名读取：

```ts
const credential = await runtime.authorization.getCredential("api-key");
const apiKey = credential?.apiKey;
const region = credential?.region;
```

### 10.3 OAuth 2.0 Authorization Code + PKCE

```json
{
  "id": "account",
  "kind": "oauth-pkce",
  "label": "Sign in with Acme",
  "description": "Sign in in your browser and return automatically.",
  "clientId": "ipollowork-public-client",
  "authorizationUrl": "https://accounts.acme.example/oauth/authorize",
  "tokenUrl": "https://accounts.acme.example/oauth/token",
  "scopes": ["research.read"],
  "audience": "https://api.acme.example"
}
```

供应商要求：

- Client 必须是无需客户端密钥的 public client。
- 支持 Authorization Code + PKCE S256。
- 授权端点接受 `response_type`、`client_id`、`redirect_uri`、`state`、`code_challenge`、`code_challenge_method`、`scope`，可选 `audience`。
- Token 端点接受表单字段 `grant_type=authorization_code`、`code`、`client_id`、`redirect_uri`、`code_verifier`。
- Token 响应至少返回 `access_token`。
- 推荐返回 `refresh_token` 和 `expires_in`，这样平台能在到期前自动刷新。

服务读取：

```ts
const credential = await runtime.authorization.getCredential("account");
const accessToken = credential?.accessToken;
```

### 10.4 Device Code / QR

```json
{
  "id": "device",
  "kind": "device-code",
  "label": "Connect device",
  "description": "Authorize with a code or QR page.",
  "clientId": "ipollowork-device-client",
  "deviceAuthorizationUrl": "https://accounts.acme.example/oauth/device/code",
  "tokenUrl": "https://accounts.acme.example/oauth/token",
  "scopes": ["research.read"],
  "qr": true
}
```

设备授权端点必须接受 `client_id` 和可选 `scope`，并返回：

```json
{
  "device_code": "private-device-code",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://accounts.acme.example/device",
  "verification_uri_complete": "https://accounts.acme.example/device?user_code=ABCD-EFGH",
  "expires_in": 600,
  "interval": 5
}
```

当 `qr: true` 且存在 `verification_uri_complete` 时，平台可用该值生成二维码。Token 轮询端点应遵循标准 `authorization_pending` 和 `slow_down` 响应。

### 10.5 Hosted Browser / 托管跳转授权

当供应商需要保留 client secret、签名私钥、复杂扫码逻辑或自己的账号绑定页面时，使用托管授权：

```json
{
  "id": "hosted-account",
  "kind": "hosted-browser",
  "label": "Connect Acme account",
  "description": "Continue on Acme's secure authorization page.",
  "startUrl": "https://plugins.acme.example/connect",
  "callbackOrigin": "https://plugins.acme.example",
  "exchangeUrl": "https://plugins.acme.example/token",
  "refreshUrl": "https://plugins.acme.example/refresh"
}
```

供应商流程：

1. iPolloWork 打开 `startUrl`，追加一次性 `state` 和 `callback_url`。
2. 供应商完成登录、扫码或账号绑定。
3. 供应商跳回 `callback_url?state=...&code=...`。
4. iPolloWork 后端把 `code` 和 `redirect_uri` 表单提交到 `exchangeUrl`。
5. `exchangeUrl` 返回标准 Token JSON。
6. 如果声明 `refreshUrl`，到期时平台以 `grant_type=refresh_token` 和 `refresh_token` 调用它。

安全要求：

- `startUrl`、`callbackOrigin`、`exchangeUrl` 和 `refreshUrl` 必须同源。
- 生产环境必须使用 HTTPS。
- client secret 和供应商私钥只能保存在供应商服务端。
- `code` 应一次性、短时有效并绑定原始 state/用户/插件安装。

### 10.6 自动刷新

OAuth、Device Code 和 Hosted Browser 凭据如包含：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600
}
```

平台会保存 `accessToken`、`refreshToken` 和计算后的 `expiresAt`，在过期前约 60 秒自动刷新。并发读取同一凭据只会发起一次刷新请求。刷新失败或没有 refresh token 时，用户需要重新连接。

### 10.7 多种授权的正确声明

如果两种授权都必须存在：

```json
{
  "requires": [
    "authorization:storage-key",
    "authorization:signing-key"
  ]
}
```

如果 API Key 与 OAuth 任选一种：

```json
{
  "authorization": {
    "required": true,
    "methods": [
      {
        "id": "api-key",
        "kind": "secret-form",
        "label": "API key",
        "fields": [
          { "id": "apiKey", "label": "API key", "secret": true, "required": true }
        ]
      },
      {
        "id": "account",
        "kind": "oauth-pkce",
        "label": "Sign in",
        "clientId": "ipollowork-public-client",
        "authorizationUrl": "https://accounts.acme.example/oauth/authorize",
        "tokenUrl": "https://accounts.acme.example/oauth/token",
        "scopes": ["research.read"]
      }
    ]
  }
}
```

资源不要同时声明两个授权硬依赖，服务按顺序读取：

```ts
const apiKeyCredential = await runtime.authorization.getCredential("api-key");
const oauthCredential = apiKeyCredential
  ? null
  : await runtime.authorization.getCredential("account");

const token = apiKeyCredential?.apiKey ?? oauthCredential?.accessToken;
if (!token) throw new Error("Connect this plugin first");
```

## 11. 依赖与构建产物

### 11.1 推荐单文件 bundle

开发目录可以是：

```text
src/
├── service.ts
└── opencode-plugin.ts
```

发布目录应生成：

```text
service/acme-research.js
.opencode/plugins/acme-research.js
```

第三方 npm 依赖应被 bundle 进去。不要假设用户机器已经安装你的包。

### 11.2 多文件发布

如果服务入口包含：

```ts
import { createClient } from "./client.js";
```

那么 `service/client.js` 也必须作为资源声明：

```json
{
  "type": "file",
  "id": "service-client",
  "path": "service/client.js",
  "required": true
}
```

未声明文件不会进入不可变版本快照，安装后可能不存在。

### 11.3 不要发布这些内容

- `.env`
- API Key、refresh token、client secret
- 私钥和签名证书
- 开发者本地绝对路径
- 无关的 `node_modules`
- 测试账号和真实用户数据
- 未使用的源码、缓存和构建日志

## 12. 本地开发流程

仓库已经提供可运行参考包：

```text
examples/plugin-packages/acme-research
```

推荐流程：

1. 把参考目录复制到目标工作区下的 `plugins/<your-plugin-id>`。
2. 修改插件 ID、名称、发布者、`updateId` 和所有路径。
3. 先实现一个动作和一个 Skill，不要一开始加入所有能力。
4. 在 **设置 → 扩展 → 插件包 → 开发者：安装本地插件包** 中填写相对路径。
5. 点击**验证**，检查将写入的文件、权限、版本和完整性状态。
6. 点击**安装**。
7. 如有授权，在插件卡片中填写 Key 或完成浏览器/设备授权。
8. 在新任务中用自然语言触发 Skill，确认不需要再次输入 Key。
9. 修改代码后提高版本，例如 `1.0.0` → `1.0.1`，再使用**更新**。
10. 验证停用、重新启用、回滚和卸载。

不要直接修改安装后复制到工作区的插件拥有文件。更新和卸载会检查文件哈希；如检测到外部修改，会停止操作以免覆盖用户内容。开发时应修改原始包目录，再提高版本并更新。

## 13. 服务 API 契约

当前桌面设置页使用以下路由。开发者通常不需要直接调用，但开发者平台、CLI 和自动化工具可以复用。

### 13.1 包生命周期

```text
GET    /workspace/:id/plugin-packages
POST   /workspace/:id/plugin-packages/validate
POST   /workspace/:id/plugin-packages
POST   /workspace/:id/plugin-packages/:pluginId/update
POST   /workspace/:id/plugin-packages/:pluginId/rollback
PATCH  /workspace/:id/plugin-packages/:pluginId
DELETE /workspace/:id/plugin-packages/:pluginId
```

校验、安装和更新请求使用：

```json
{
  "packageRoot": "plugins/acme-research"
}
```

停用或启用使用：

```json
{
  "enabled": false
}
```

写操作要求可写服务器、具有协作者权限，并可能触发用户审批。

### 13.2 授权生命周期

```text
GET    /workspace/:id/plugin-packages/:pluginId/authorization
POST   /workspace/:id/plugin-packages/:pluginId/authorization/:methodId/credentials
POST   /workspace/:id/plugin-packages/:pluginId/authorization/:methodId/start
GET    /workspace/:id/plugin-packages/:pluginId/authorization/callback
POST   /workspace/:id/plugin-packages/:pluginId/authorization/callback
POST   /workspace/:id/plugin-packages/:pluginId/authorization/device/:flowId/poll
DELETE /workspace/:id/plugin-packages/:pluginId/authorization/flows/:flowId
DELETE /workspace/:id/plugin-packages/:pluginId/authorization/:accountId
```

保存 Secret Form：

```json
{
  "accountId": "default",
  "values": {
    "apiKey": "user-entered-value"
  }
}
```

公开响应永远不应包含上面的原始值。

## 14. 版本、更新和回滚

### 14.1 语义版本建议

- Patch：修复实现，不改变动作契约，例如 `1.0.0` → `1.0.1`
- Minor：增加向后兼容动作或能力，例如 `1.0.0` → `1.1.0`
- Major：删除动作、改变参数或授权语义，例如 `1.0.0` → `2.0.0`

### 14.2 不可变版本

同一插件 ID 的同一版本内容不可变化。安装器会保存每个资源的 SHA-256。相同版本但文件不同会被拒绝。

### 14.3 更新时授权处理

- 保留新版本仍声明的授权方法及凭据。
- 删除新版本已经移除的授权方法、待处理流程和活动账户选择。
- 更新后释放旧服务实例，首次使用时加载新版本。
- 回滚时恢复上一不可变版本并重新协调授权方法。

### 14.4 文件冲突

以下情况会停止安装或更新：

- 目标路径已经存在且不是当前插件拥有文件。
- 当前插件拥有文件被用户或其他程序修改。
- 资源文件缺失。
- 路径逃逸插件根目录或工作区。

插件管理器不会静默覆盖冲突文件。

## 15. 完整性校验

本地包允许不声明 checksum，此时显示为 `unsigned`。声明 checksum 后必须匹配，否则校验失败。

计算规则：

1. 解析清单。
2. 从清单副本中移除 `package.checksum`。
3. 对对象键递归排序，生成无额外空白的规范 JSON。
4. 对规范清单 JSON 计算 SHA-256 十六进制值。
5. 向总哈希依次写入：

```text
ipollowork.plugin.json + NUL + manifestSha256 + LF
```

6. 按资源相对路径排序，对每个声明文件写入：

```text
relativePath + NUL + fileSha256 + LF
```

7. 总哈希的 SHA-256 十六进制值写入：

```json
{
  "checksum": {
    "algorithm": "sha256",
    "value": "..."
  }
}
```

未来商城还应在 checksum 之外增加发布者签名和审核状态。checksum 证明内容未变化，不单独证明发布者身份。

## 16. 错误排查

| 错误码/现象 | 常见原因 | 处理方式 |
|---|---|---|
| `plugin_package_manifest_missing` | 根目录没有清单 | 把 `ipollowork.plugin.json` 放在包根目录 |
| `plugin_package_metadata_required` | 没有 `package` | 增加版本、updateId 和 entrypoints |
| `plugin_package_resource_missing` | 声明文件不存在 | 修正 path 或加入文件 |
| `plugin_package_path_invalid` | 绝对路径或 `..` | 全部改成安全相对路径 |
| `plugin_package_incompatible` | 运行时不满足兼容范围 | 调整版本范围或升级运行时 |
| `plugin_package_checksum_mismatch` | 内容与 checksum 不一致 | 重新构建后重新计算 checksum |
| `plugin_package_version_changed` | 同版本内容被修改 | 提高语义版本 |
| `plugin_package_conflict` | 目标文件存在或拥有文件被改 | 更换路径或先处理用户修改 |
| `plugin_authorization_required` | 服务声明的授权尚未连接 | 引导用户到设置页连接 |
| `plugin_authorization_expired` | Token 过期且无法刷新 | 重新连接插件 |
| `plugin_authorization_refresh_failed` | 刷新端点失败 | 检查 provider refresh 契约并重新连接 |
| `plugin_service_invalid` | 默认导出或返回结构错误 | 默认导出工厂并返回 `actions` 对象 |
| `plugin_service_action_missing` | 清单动作没有实现 | 让 `actions` key 与清单 ID 完全一致 |

清单校验错误会带字段路径，例如：

```text
resources.2.requires.0: references an unknown authorization method
```

优先修正最前面的结构错误，再重新验证。

## 17. 安全与审核清单

### 17.1 开发者自查

- [ ] 插件包中没有任何真实 Key、Token、Secret 或私钥。
- [ ] `trusted` 对第三方包为 `false`。
- [ ] 所有网络地址生产环境使用 HTTPS。
- [ ] 权限声明与实际行为一致。
- [ ] Skill 不要求用户在聊天中粘贴 Key。
- [ ] 服务返回值和日志不包含凭据。
- [ ] 服务对网络超时、响应大小和错误做限制。
- [ ] 所有相对导入文件都在 resources 中声明。
- [ ] 动作输入 Schema 设置 `additionalProperties: false`。
- [ ] 写文件动作限制在当前工作区。
- [ ] `dispose()` 能关闭长连接、计时器和后台资源。
- [ ] 新版本提高了语义版本，旧版本内容未被覆盖。
- [ ] 安装、授权、使用、重启、更新、停用、回滚和卸载都经过测试。

### 17.2 平台审核重点

- 可执行代码是否与声明能力一致。
- 是否存在动态下载并执行未审核代码。
- 是否绕过插件授权存储读取全局 Key。
- 是否收集超出功能所需的数据。
- 是否把工作区内容发送给未声明的第三方。
- 是否有隐蔽进程、持久化或自更新逻辑。
- 是否伪造发布者、图标或内置插件名称。
- 是否能在卸载后留下进程、MCP 配置或拥有文件。

## 18. 上传与发布检查表

当前本地安装：

- [ ] 插件目录位于工作区内部。
- [ ] 清单直接位于目录根部。
- [ ] 设置页验证结果无错误。
- [ ] 预览文件列表与预期一致。
- [ ] 安装后可以连接并调用。

未来商城上传：

- [ ] ZIP 根目录直接包含 `ipollowork.plugin.json`。
- [ ] ZIP 文件名包含插件 ID 和版本。
- [ ] `id`、`publisher.id` 和 `updateId` 与开发者账号一致。
- [ ] 所有声明文件存在且没有额外秘密文件。
- [ ] checksum 已生成并匹配。
- [ ] 兼容范围已在最低和最高目标版本验证。
- [ ] README、隐私说明、支持链接和 CHANGELOG 完整。
- [ ] 上传版本是新版本且内容不可变。
- [ ] 审核完成后才允许进入正式渠道。

## 19. 推荐的第一个插件开发步骤

如果你第一次开发，按下面范围开始最稳妥：

1. 从 `examples/plugin-packages/acme-research` 复制一份。
2. 只保留一个 Skill、一个 local-service、一个 `secret-form`。
3. 只实现一个只读动作，例如搜索或查询状态。
4. 让动作返回简单 JSON，不先做文件写入。
5. 验证“安装一次、填 Key 一次、重启后继续使用”。
6. 再增加 OAuth、MCP、写文件或 OpenCode 钩子。

参考实现：

```text
examples/plugin-packages/acme-research/ipollowork.plugin.json
examples/plugin-packages/acme-research/service/acme-research.ts
examples/plugin-packages/acme-research/.opencode/plugins/acme-research.ts
examples/plugin-packages/acme-research/.opencode/skills/acme-research/SKILL.md
```

## Test Steps

### A. 清单与目录

1. 创建包含根清单的最小插件目录。
2. 使用安全相对路径声明每个资源。
3. 验证缺少清单、缺少资源、重复 ID、未知依赖和路径逃逸都会失败。
4. 验证包预览只列出 resources 中声明的文件。

### B. 安装与组合

1. 安装包含 Skill、OpenCode plugin、MCP 和 local-service 的测试包。
2. 确认 Skill 文件被复制，OpenCode plugin 被注册，MCP 被注册，服务动作可发现。
3. 停用插件，确认 MCP、OpenCode plugin 和服务不可用。
4. 重新启用并确认恢复。

### C. 授权

1. 保存 Secret Form，确认 API 响应和磁盘密文中没有明文 Key。
2. 完成 OAuth PKCE，确认 callback state 只能消费一次。
3. 完成 Device Code，确认 pending/slow_down 正常处理。
4. 完成 Hosted Browser，确认端点同源校验。
5. 模拟 Token 即将过期，确认并发调用只刷新一次。
6. 重启应用，确认连接和活动账户仍然存在。

### D. 服务生命周期

1. 连续调用同一动作两次，确认服务工厂只执行一次。
2. 更新授权，确认旧服务被 dispose 并在下一次调用重建。
3. 更新、回滚、停用、卸载和关闭服务器，确认 dispose 被调用。
4. 初始化失败后再次调用，确认可以重试。

### E. 更新安全

1. 安装 `1.0.0`。
2. 用不同内容重复安装 `1.0.0`，确认失败。
3. 安装 `1.0.1`，确认上一版本可回滚。
4. 手工修改插件拥有文件，再更新，确认冲突阻止覆盖。
5. 卸载插件，确认无关工作区文件仍存在。

### F. 用户体验

1. 在中文和英文设置界面验证状态文案。
2. 普通用户完成安装和连接，不需要理解组件结构。
3. 新任务触发 Skill，不再次输入 Key。
4. 授权不足时只引导到设置页，不在聊天中收集秘密。

## Acceptance Criteria

- 开发者仅凭本文和仓库参考包即可创建一个可验证、可安装、可授权、可调用、可更新和可卸载的插件。
- 文档明确说明当前不需要专用框架，也不承诺自动安装依赖或执行构建脚本。
- 文档明确区分当前工作区目录安装与未来 ZIP 商城上传。
- 清单字段、资源类型、关系语义、四种授权、服务接口和生命周期与当前代码实现一致。
- 文档包含最小目录、完整目录、完整清单、Skill、服务、MCP 和授权示例。
- 文档覆盖版本不可变、checksum、冲突处理、安全边界、常见错误和发布检查表。
- 示例插件通过实际清单预览校验。

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-21 | 1.0.0 | 建立完整中文插件开发、授权、打包、上传与发布指南 | Codex |

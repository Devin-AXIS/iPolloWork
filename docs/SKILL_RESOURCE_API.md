# 技能资源接口与接入说明

本文对应 `feature/enterprise-collaboration` 分支。技能列表统一为「个人 / 公开 / 企业名称」。桌面技能页不再调用 GitHub / Hub 仓库获取技能，已有本地技能继续保留。

## 1. 实现状态与边界

| 范围 | 状态 |
| --- | --- |
| 个人技能列表、查看、编辑、技能包导入、完整导出 | 本分支已实现；全局技能只读，插件所属技能由插件管理 |
| 企业技能投稿、审核、权限、通知、后台技能 Tab | iPolloEnterprise 企业协作分支已实现 |
| 企业技能下载、安装、更新、启停、卸载、任务前权限核验 | 本分支已实现 |
| 公开技能列表与下载客户端 | 已按下文协议接入 |
| 公开技能云端服务 | 需要云端项目补充；本文为接入契约，不能将客户端接入视为云端接口已经上线 |

独立技能的资源类型为 `skill`。插件资源类型仍为 `extension`，插件包中包含的 Skill 仍属于该插件，不自动拆成独立技能。技能包不能注册 UI、MCP、Provider、安装钩子或后台服务。依赖声明只用于说明，不授予工具权限，也不自动安装插件。

个人导入和公开市场安装的技能共享本地独立技能生命周期。安装后 OpenCode 直接发现项目中的 `.opencode/skills`；Codex 和 DeepSeek Harness 在任务开始前，通过宿主管理的目录链接分别从 `.agents/skills/ipollowork-standalone` 和 `.dsh/skills/ipollowork-standalone` 读取同一份文件，编辑和卸载无需维护多份副本。插件内置技能继续由插件自身的引擎适配器提供。企业技能必须先安装并启用，在每个任务开始前核验当前企业成员及资源权限；浏览个人或公开标签不会退出企业技能上下文。公开目录中未安装的技能不会自动进入对话。

## 2. 统一技能包

上传和个人导入同时支持单个 UTF-8 `.md` 文件（例如 `SKILL.md`，最大 1 MiB）。文件必须包含下例 frontmatter 中的 `name`、`description`，名称不从文件名推断。可选 `title` 指定展示名；可选 `version` 或 `metadata.version` 指定版本，省略时为 `1.0.0`。修改正文后再次投稿时需要增加版本号。

```markdown
---
name: market-research
description: 整理调研材料并生成有依据的结论。
version: 1.0.0
---
# 市场调研
核对来源后再整理结论。
```

单个 MD 只导入文件本身，不会读取同目录的脚本、图片或参考资料；需要这些文件时请使用下方完整技能包。宿主和企业服务将 MD 规范化为包含清单与 `SKILL.md` 的技能包，企业下载接口仍返回 `.ipollowork-skill`，摘要按规范化后的完整包计算。MD 不会注册或执行插件能力。

- 扩展名：`.ipollowork-skill`。
- MIME：`application/vnd.ipollowork.skill+zip`。
- 容器：ZIP，支持 stored / deflate；禁止符号链接、路径穿越、重复路径及大小写冲突。
- 压缩包、解压后内容均不超过 50 MiB，最多 512 个文件，单文件不超过 25 MiB，`SKILL.md` 不超过 1 MiB。
- 禁止 `.env`、隐藏配置目录、`node_modules`、二进制可执行文件和 Windows 特殊路径。
- 脚本作为被动配套文件保存，上传、预览和安装时均不执行。

```text
ipollowork.skill.json
SKILL.md
references/          # 可选
scripts/             # 可选
assets/              # 可选
```

规范清单示例：

```json
{
  "schemaVersion": 1,
  "kind": "skill",
  "id": "personal.market-research",
  "name": "market-research",
  "title": "市场调研技能",
  "description": "整理调研材料并生成有依据的结论。",
  "version": "1.0.0",
  "entry": "SKILL.md",
  "category": "research",
  "minimumAppVersion": "0.50.18",
  "dependencies": []
}
```

`id` 是包的稳定标识，允许小写字母、数字、点与连字符，必须包含至少一个分隔段，最多 128 字符。`name` 是技能调用名，允许小写字母、数字、连字符，最多 64 字符。企业或云端的 `resourceId` 与包 `id` 是不同标识。

`SKILL.md` 必须包含标准 frontmatter，`name` 与清单一致，`description` 非空：

```markdown
---
name: market-research
description: 整理调研材料并生成有依据的结论。
---

# 市场调研
先阅读 references/research-guide.md，再核对来源并整理结论。
```

支持的配套文件类型为 Markdown、文本、JSON、YAML、CSV/TSV、HTML/CSS、JS/MJS/TS、Python、Shell、PowerShell、SVG、PNG/JPEG/WebP/GIF、PDF 和 Notebook；脚本的可执行位仅允许用于 `scripts/` 下的脚本文本。`LICENSE` / `NOTICE` 可无扩展名。`ipollowork.source.json` 是宿主安装记录，不允许出现在投稿包中。

同一包 ID 和版本的内容应保持不变；改内容需要增加版本。相同内容重复投稿返回同一版本，不重复创建审核记录。

## 3. 公开云端：本次客户端已调用的接口

基地址使用软件配置的 iPollo Account / Cloud `baseUrl`，不使用企业地址或 GitHub。

### GET /api/v1/skills

用于公开技能目录。建议允许匿名读取已审核、已发布资源；客户端登录后会附带现有 Cloud Bearer Token。

查询参数：

| 参数 | 说明 |
| --- | --- |
| `limit` | 1–50，客户端当前发送 50 |
| `cursor` | 不透明分页游标，最多 128 字符；首页不传 |
| `search` | 名称、标题、说明或作者搜索，最多 160 字符 |

```json
{
  "items": [
    {
      "id": "skill_market_research",
      "type": "skill",
      "name": "market-research",
      "title": "市场调研技能",
      "description": "整理调研材料并生成有依据的结论。",
      "category": "research",
      "authorName": "iPollo",
      "updatedAt": "2026-10-19T08:00:00.000Z",
      "latestVersion": {
        "version": "1.0.0",
        "digest": "完整的64位小写SHA256十六进制字符串",
        "minimumAppVersion": "0.50.18"
      }
    }
  ],
  "nextCursor": null
}
```

上述摘要字段为说明占位，实际响应必须返回 64 位小写十六进制 SHA-256。每个列表项必须有可下载的最新审核通过版本；不要把待审核版本放进这个目录。`type` 必须为 `skill`，不能返回插件。

分页应稳定排序；最后一页 `nextCursor: null`，不能重复返回相同游标。客户端最多展开 500 条，再通过搜索缩小范围。

### GET /api/v1/skills/{resourceId}/versions/{version}/download

返回原始 `.ipollowork-skill` 二进制。客户端会校验目录摘要、响应摘要和实际文件摘要一致，再交给本地服务做包内容校验。

```http
Content-Type: application/vnd.ipollowork.skill+zip
Content-Disposition: attachment; filename="market-research-1.0.0.ipollowork-skill"
X-iPollo-Artifact-SHA256: <与目录一致的64位小写SHA256>
X-iPollo-Resource-Type: skill
```

是否要求登录可由云端现有下载政策决定；客户端有 Cloud 登录态时会发送 `Authorization: Bearer <token>`。请复用现有身份验证机制，不新增一套技能账号。

仅允许下载已发布且通过审核的指定版本。撤回或下架后返回 `404`。下载接口直接返回文件，不重定向到其他域名，避免携带授权头跨域和签名地址泄露。

跨域服务需要允许软件现有 Origin 与 `Authorization` 请求头，并暴露 `Content-Disposition`、`X-iPollo-Artifact-SHA256`、`X-iPollo-Resource-Type`。生产环境使用 HTTPS。

### 错误响应

```json
{ "error": "skill_not_found" }
```

| 状态码 | 说明 |
| --- | --- |
| 400 | 搜索、分页或版本参数不合法 |
| 401 | 需要登录或登录已过期 |
| 403 | 已登录但无操作权限 |
| 404 | 技能不存在、已下架或版本不可下载 |
| 429 | 访问频率过高，可返回 `Retry-After` |
| 503 | 暂时不可用 |

若列表接口返回 `404`、`405`、`501`，当前客户端显示“公开云端尚未开放技能市场接口”；不会转向 GitHub 或旧团队技能接口。

## 4. 公开云端：后续详情和投稿接口设计

本节为云端补充设计，当前客户端的首版公开目录仅调用第 3 节两个接口。

| 方法与路径 | 身份 | 建议行为 |
| --- | --- | --- |
| `GET /api/v1/skills/{id}?version=1.0.0` | 目录同等权限 | 返回 `manifest`、转义展示用 `content`、`files`，不执行 Markdown / HTML / 脚本 |
| `POST /api/v1/skill-submissions` | Cloud Bearer | 请求体为原始技能包；服务器校验后生成待审核版本，不能直接公开 |
| `GET /api/v1/skill-submissions?cursor=...&limit=20` | Cloud Bearer | 仅返回当前作者的投稿及审核说明 |

投稿新建返回 `201`，相同摘要的重复提交返回 `200`；同版本不同内容返回 `409 resource_version_already_exists`。审核、发布、下架继续使用云端已有管理体系，审核动作与下载资格由服务端决定。

公开内容可能被下载和复制。公开技能不要用企业凭据或企业私密材料制作；企业私有资源不会通过本次功能自动上传到公开云端。

## 5. 企业接口：已在 iPolloEnterprise 实现

企业调用使用对应企业签发的 Enterprise Session。所有列表、预览、下载和写操作均校验当前成员状态与资源权限。

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/v1/client-manifest` | 返回 `features.skills`、`features.skillPublishing`、`labels.skillSource` |
| `GET /api/v1/resources?type=skill&limit=50&cursor=...` | 当前成员可见、已发布且有已审核版本的技能 |
| `GET /api/v1/resources?type=skill&view=manage` | 技能管理员或全局管理员管理列表 |
| `GET /api/v1/resources/{id}?version=1.0.0` | 已授权技能正文、清单与文件列表 |
| `GET /api/v1/skill-submissions` | 当前成员自己的投稿 |
| `POST /api/v1/skill-submissions` | 原始技能包或 UTF-8 技能 MD 投稿；MD 建议 `Content-Type: text/markdown; charset=utf-8`，新建 201，重复 200 |
| `POST /api/v1/resources/{id}/versions/{version}/review` | 技能审核，`approved` / `rejected`，退回需说明 |
| `GET/PUT /api/v1/resources/{id}/access` | 员工、部门及包含子部门授权，使用现有 revision 冲突控制 |
| `GET /api/v1/resources/{id}/versions/{version}/download` | 权限核验后返回技能包和 SHA-256 |
| `PATCH /api/v1/resources/{id}` | `{ "status": "archived" }` 下架 |

包格式见第 2 节。企业列表格式沿用现有资源接口，最新已发布版本在 `latestVersion`，下载路径由企业返回。无权限的预览和下载使用 `404`，避免披露私有资源是否存在。

新增员工角色 `skill_admin`，仅管理、审核、授权技能，不能管理插件或模板。`admin` 和兼容的 `owner` 可管理全部资源。后台超管登录身份与员工角色保持独立。

## 6. 本地宿主接口与权限生效

这些接口由 iPolloWork 本地服务实现，使用现有本地服务身份；不是公开云端要实现的接口。

| 方法与路径（均以 `/workspace/{id}` 开头） | 功能 |
| --- | --- |
| `GET /skill-packages` | 当前项目个人技能、插件归属信息与当前企业成员安装记录 |
| `POST /skill-packages/export` | 根据 `{name,title,version}` 导出完整技能包 |
| `POST /skill-packages/import` | 导入本地技能 MD / 技能包或公开云端包，校验上传原始字节摘要，拒绝覆盖其他来源或本地改动 |
| `PUT /skill-packages/context` | 绑定或清空当前企业成员上下文；企业 Token 只在内存中使用 |
| `POST /skill-packages/enterprise` | 本地服务向企业重新鉴权并下载、校验后安装 |
| `GET/PATCH/DELETE /skill-packages/enterprise/{resourceId}` | 查看、启停、卸载该成员的企业技能 |

企业技能按服务地址、企业、成员、资源身份隔离保存，不与个人或插件技能共用安装记录。OpenCode、Codex Harness、DeepSeek Harness 在各自原生技能目录中得到受宿主管理的技能文件；名称带来源标识，避免同名覆盖。

每次新任务或新一轮发送前，宿主重新检查企业成员状态与资源访问权限。离线、过期、撤权、下架时不再提供有效的技能文件。正在运行的任务不强行终止，已经进入历史会话的内容不会被抹除；已有本地复制文件也不能承诺远程收回。

更新先验证完整包再切换，失败保留原版本。个人技能或插件技能重名时不会静默覆盖；已修改的公开技能更新会提示先保留副本。

## 7. 联调验收

1. 同一份客户端导出的包可通过企业校验和本地安装，配套文件完整。
2. 公开目录返回技能而非插件；列表与下载摘要一致；未部署接口时有明确提示。
3. 员工 A 投稿，技能管理员审核并授权 B；B 可预览、下载、安装并在任务中调用。
4. 插件管理员不能审核技能，技能管理员不能管理插件或模板。
5. 重复投稿不重复创建版本；新版本审核期间旧的已发布版本仍可使用。
6. 撤权、下架、停用成员或切换账号后，新任务不再加载原账号的技能。
7. 个人技能与插件内置技能不会被企业安装、更新、卸载误操作。
8. 安装和预览不执行脚本；恶意路径、混合插件包、摘要不一致和缺失入口都被拒绝。

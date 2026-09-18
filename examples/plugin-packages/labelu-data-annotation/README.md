# 数据标注实训云

本定制发行版在 zjy-web222 发布的 0.3.2 插件基础上升级至 0.4.16，增加本地角色切换、审核和 JSON 导出，并替换实训素材。插件随应用离线内置并自动启用。用户可以在右侧工作台完成图片、视频、音频和文字标注，也可以从带文字层的 PDF、Word（DOC/DOCX）或 TXT 导入正文。

## 使用方式

1. 启动本分支 iPolloWork，内置插件会自动安装或升级至 0.4.16。
2. 点击左侧“数据标注”或右侧控制台的数据标注入口。
3. 在右侧工作台上传自己的素材，或选择已经配好素材和标签的实训项目。
4. 默认角色是“标注员”。保存后，可从“我的标注”继续编辑，记录状态为“待审核”。
5. 返回插件首页，将右上角“工作角色”切换为“审核员”，在“审核记录”中筛选本工作区的记录，点击打开详情。图片可查看目标框和轮廓，音视频可播放并查看片段，文字可核对正文和实体区间。审核模式不能改动标注。
6. 填写审核意见，选择“审核通过”或“退回修改”。退回必须填写原因；没有保存任何标注的空记录不能通过。
7. 审核通过后，两种角色都可以在详情顶部点击“导出 JSON”，文件保存到主软件的下载位置。未通过、已退回或有未保存修改时不能导出。修改正文、标签或标注并保存，会重新变为待审核；只播放、查看或保存相同内容不影响通过状态。

角色是本机工作模式，不是登录账号或多人权限系统。新打开的工作台默认标注员，同一工作台刷新保留所选角色。审核结果随记录保存在磁盘上；旧版记录自动按待审核读取。审核绑定记录版本，同时打开多个页面时，过期保存或审核会提示版本冲突，请重新打开详情读取最新记录。

## 关键帧、片段描述与图片拖动

- 视频暂停在目标画面后，点击“标记当前关键帧”，填写描述。右侧标记列表显示时间，点击可跳回对应画面，编辑按钮可填写名称和描述；时间戳使用秒并保留小数。
- 在视频或音频下方原生时间轴中拖拽创建片段，再点击右侧标记列表的编辑按钮，填写标记名称和描述。描述直接显示在片段上；较窄片段可悬停查看完整内容。保存项目后，重新打开仍可查看和修改。
- 图片点击工具栏“拖动画布”，即可用鼠标左键平移图片；再次点击回到标注。也可按住空格＋左键或直接按住右键拖动。平移仅改变视图，不改变标注坐标或审核结果。
- 描述保存于原生标注的 `attributes.描述` 字段；关键帧保存于 `annotations.frame`，包含 `time`、标签和描述。审核通过后的 JSON 同时包含片段和关键帧数据。修改描述或关键帧后需重新审核。

## 多边形与标签集

- 图片选择多边形工具，依次点击至少三个顶点，再点击第一个顶点（起点周围 10 像素内），即可闭合并自动完成一条标注。原有右键完成方式仍可使用。
- 图片、文字、音频和视频右侧顶部统一提供“标记 / 标签集”两个页签：“标记”查看、编辑、显隐或删除标记；“标签集”新增、重命名、换色、排序和删除当前项目标签。切换到标签集前会先保存已经完成的未保存标注，失败时保留现场并提示。
- 点击标记的编辑图标，在“详细信息”气泡中填写“标记名称”，也可修改“标签类别”。名称只属于这一条标记，右侧列表同步显示；保存和导出的 JSON 中保存在该标记的 `attributes.标记名称`。改名不会改变所属标签集。
- 修改后点击“应用标签”。删除已使用的标签需要选择替换标签，已有标注会同步更新。未应用的修改可点“还原”；审核员仅能查看，需切换标注员后修改。

## 实训项目与素材

内置 12 个项目，每类 3 个。图片为真实施工现场、回收桶、植物叶片；视频为道路活动、行人场景和花朵开放延时摄影；音频为真人中文诗歌朗读，以及两位朗读者片段拼接的说话人练习。拼接录音不是原始对话。三份文字是明确标记为虚构教学示例的长篇校园新闻、八条课程评价和完整活动通知。

素材随插件本地分发，可离线打开。新建实训项目会复制素材与标签，已有项目不会被替换。卡片展示作者和许可，详情“项目”面板显示来源链接及修改说明，JSON 中也会保留素材来源。完整声明见 `NOTICE.txt`。

## 与主软件配合

先在主软件选择项目（工作区），再点击左侧“数据标注”。本地记录保存在该工作区的 `.ipollowork/plugins/labelu-data-annotation/projects/`，素材保存在相邻 `uploads/` 中。备份或迁移时一起复制整个插件目录。不同工作区的记录互相隔离。

主软件的对话引擎可按用户指令调用下述 MCP 扩展动作，读取、创建和更新项目、管理标签、审核、导出或删除记录。工作台与 MCP 共用同一套存储和版本检查。通过后导出的 JSON 可作为后续统计、数据清洗或训练数据整理的输入。

导出文件包含 `format: "ipollowork.annotation"`、导出结构版本、导出时间和完整 `project`：正文、标签、颜色、原生标注数据、记录版本及审核意见/时间。媒体使用工作区相对路径，不嵌入二进制文件或访问令牌；交付给其他人时需另行附带对应素材。这不是 COCO、YOLO 等格式的自动转换。

## 隔离边界

- 插件通过应用现有的内置插件生命周期安装 Skill、服务和工作台。
- 图片、视频、音频、PDF、Word、TXT 解析和标注数据均在本机处理。
- 项目数据只写入当前工作区的插件专属目录。
- 应用在服务端拒绝卸载和停用本插件及其资源。
- 对话侧按用户指令调用接口；上传自己的媒体和文档仍在工作台完成。

## 来源与许可

0.3.2 基线来自 `ipollowork-labelu-plugin-0.3.2-signed.ipollowork-plugin`（文件 SHA-256：`6d3d6df825c6a06be7e790793860da33c0bd28d3a83d5294fc064ac9c2ce964d`），导入时已验证资源摘要和 Ed25519 签名。0.4.16 的 `app/dist`、`service/dist` 由本目录升级后的源码重新构建。原包签名仅适用于原始 0.3.2 包，不适用于升级后的代码或定制清单。

这些运行资源和实训素材随桌面安装包离线分发，因此保留在版本控制中；前端、服务及各自构建配置由此插件独立维护，不加入主应用的依赖图。桌面打包仅包含清单、许可、技能、工作台入口和两个运行资源目录，不包含开发依赖。

0.3.2 复用 LabelU 的音视频播放器支持拖动区间标注，通过动态导入按需加载；新增的 `word-extractor`（MIT）及其类型声明负责 DOC/DOCX 正文解析。相关依赖固定在插件自己的锁文件中，许可随包分发，主应用无需安装这些开发依赖。

本插件使用 [OpenDataLab LabelU-Kit](https://github.com/opendatalab/labelU-Kit) 的标注组件，并使用 [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 提取 PDF 文字。二者均采用 Apache License 2.0。

本插件不是 OpenDataLab 或 Mozilla 的官方插件，也不代表其认可或背书。第三方许可与声明见 `LICENSE-THIRD-PARTY.txt` 和 `NOTICE.txt`；插件自身代码适用 iPolloWork 仓库根目录的许可证。

开发类型直接引用已有 LabelU 依赖树中的 `@labelu/interface@1.3.1`（Apache-2.0），用于声明名称和描述的原生属性配置，避免重复定义上游契约；它仅包含类型声明，放在开发依赖中，不增加运行时代码。

文字标注右侧使用“标记 / 标签集”页签，标签集与图片、音视频共用管理操作；项目状态面板不再重复提供入口。文档分类输入已移除，新项目仅保存区间标注；编辑旧记录时保留已有的历史附加字段。

## 主软件 MCP 接口

复用主软件已有 MCP server 的扩展工具，不新建端口或独立 MCP 进程。固定 extensionId 为 labelu-data-annotation，local-service 为 labelu-data-annotation-service。接口声明以 ipollowork.plugin.json 中 actions/inputSchema 为准，执行入口为 service/data-annotation.ts。适用于主软件共用此 MCP 扩展通道的两种引擎，不包含模型登录和推理能力的保证。

| action | effect | args 与返回结果 |
| --- | --- | --- |
| open-workbench | read | 空参数 → {url}，仅交给内置浏览器，不输出令牌 |
| list-projects | read | limit 可选，默认 25，最大 100 → 最近项目摘要数组 |
| get-project | read | projectId → 完整 ProjectRecord |
| list-training-templates | read | 空参数 → 模板摘要数组，含 id、modality、标签与来源 |
| create-training-project | write | templateId → 新项目，包含复制的内置素材 |
| create-text-project | write | textContent、可选 title → 新文字项目 |
| update-project | write | projectId、expectedRevision、annotations、可选 textContent → 保存后的完整项目 |
| update-project-labels | write | projectId、expectedRevision、labels、可选 replacements → 更新后的完整项目 |
| review-project | write | projectId、expectedRevision、status（approved/rejected）、可选 comment → 审核后的完整项目 |
| export-project | read | projectId → {format, schemaVersion, exportedAt, project} |
| delete-project | destructive | projectId、expectedRevision → {ok: true, projectId}，保留素材 |

MCP 调用示例（工具 ipollowork_extension_call）：

~~~json
{"extensionId":"labelu-data-annotation","action":"create-text-project","args":{"title":"人物提取","textContent":"李明来到上海。"}}
~~~

从返回项目读取 id 和 revision，然后保存标注：

~~~json
{"extensionId":"labelu-data-annotation","action":"update-project","args":{"projectId":"<返回的 id>","expectedRevision":0,"annotations":{"spans":[{"id":"person-1","start":0,"end":2,"text":"李明","label":"实体"}]}}}
~~~

原生主软件客户端也可通过 callExtensionAction(payload) 调用，对应 POST /experimental/extensions/call；context.directory 由宿主填入当前工作区。成功响应为 {ok: true, extensionId, action, result}，上表为 result 的结构；失败必须检查宿主错误响应，不能把调用返回当作业务成功。

并发规则：更新、改标签、审核和删除都要求读取过的 expectedRevision；冲突不覆盖已有记录。审核也会递增 revision，导出只接受与当前 revision 绑定的通过结果。退回需要意见，空记录不能通过。角色只在首页切换；接口执行不会切换任何已打开页面的角色。MCP 修改标注、标签和审核记录的 updateSource 为 ai，人工页面操作为 user。

annotations 是完整替换，不是补丁。文字使用 spans，图片使用 LabelU 原生 point/line/rect/polygon/cuboid 等集合，音视频使用 segment/frame；保留 get-project 返回的完整原生字段。新增文字区间需满足 textContent.slice(start,end) === text。JSON 导出是返回数据，不自动落盘；通过主软件文件工具保存用户指定位置即可。访问令牌、mediaUrl 与二进制不进入导出对象。

错误语义：参数无效或缺失、项目不存在（404）、版本冲突/未通过审核/使用中标签缺少替代（409）、正文超过 5 MB（413）、标签最多 50 个、标注 JSON 最多 20 MB。宿主 MCP 可能把服务异常包装成工具错误，调用端应检查错误而非依赖 HTTP 数字透传。创建操作不具备幂等键，超时后先查询记录再决定是否重试。

本版保留工作台上传/文档提取 HTTP 接口供内嵌页面使用，不向 MCP 暴露任意磁盘路径、远程下载、二进制上传或批量自动审核。MCP 修改后在首页点击刷新记录并重开详情；已打开的旧版本保存会被版本检查拦截。

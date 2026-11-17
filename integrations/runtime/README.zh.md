# Official DSH dependency

[English](README.md) | 中文

`upstream.json` 固定官方源码版本、压缩包 SHA-256 和 npm 发布身份。品牌客户端从该源码版本构建。公共插件也已测试官方 0.2.2-rc.3 桌面发行包，并按宿主实际导出选择认证 API。

在产品仓库根目录执行 `npm run setup:build`。源码下载至 `.upstream/dsh`；忽略的本地链接支持 TypeScript 与构建导入。安装过程不向 Git 跟踪的产品目录复制官方源码，也不修改官方源码。Git 元数据仅位于缓存中，使官方构建独立识别自己的版本，不依赖产品历史。

`npm run check:upstream` 校验原始源码哈希并拒绝跟踪上游实现目录。在本目录执行 `node check-pin.mjs` 校验已下载的源码。现有文件和会话不存放在依赖缓存中。

[DSH 兼容记录](compatibility.zh.md)列出产品对上游接口的依赖和升级验证步骤。

可在本目录执行 `npm ci --ignore-scripts` 单独检查官方 npm 发布包，不用它混合或替换源码构建的桌面依赖图中的单个包。

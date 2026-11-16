# 数据标注实训云

[English](README.md) | 中文

独立 DSH 插件 `@ipollo/dsh-data-annotation`，迁移自智慧未来学校数据标注实训云 0.3.0。保留图片、视频、音频、文字标注、带文字层 PDF 导入、十二个实训项目、标签编辑和保存记录。使用 DSH 0.2.2-rc.3 官方插件生命周期、侧栏、工作区、认证、工具及 Skill，不修改上游，不增加第二套 Agent。

## 构建与安装

在本目录运行 `npm ci --legacy-peer-deps`、`npm run check`、`npm run pack:check`、`npm pack`。仓库开发在安装依赖后运行 `npm run link:workspace`，前提是根目录的官方运行时已构建。使用官方命令 `dsh plugin --profile <profile> add /绝对路径/ipollo-dsh-data-annotation-0.1.0.tgz` 安装。DSH 如提示重启，请重启对应配置。核对 profile，避免误装进其他或正在工作的配置。

侧栏打开“数据标注实训云”，选择已有 DSH 工作区，再打开工作台。记录继续保存在 `<工作区>/.ipollowork/plugins/labelu-data-annotation`；旧 schema-1 任务可直接读取，不自动重写。不自动搬移其他工作区数据，卸载保留用户文件。

`ipollo_annotation` 仅提供 `list-projects`、`get-project`，参数放入 `input`，会话不能修改标注。工作台要求 DSH 所有者认证；本地服务负责素材处理，停用时释放。服务令牌留在 Host，不进入浏览器存储和工作台 URL。此边界不能隔离其他 Host 插件或任意 shell 访问。PDF 导入只提取已有文字，不执行 OCR、不上传云端。

## 验证

`npm run check` 构建 UI 和服务，检查 PDF 导入、旧记录、标签修订、实训素材及只读会话接口。还需真实 DSH profile 验证认证、客户端加载、明暗主题及工作区隔离。LabelU 按需加载的大文件会触发 Vite 体积警告，不代表导入失败。

来源与许可见 `NOTICE.txt`、`LICENSE-THIRD-PARTY.txt`、`LICENSE`。LabelU-Kit、PDF.js 采用 Apache-2.0，本插件不代表其官方认可。

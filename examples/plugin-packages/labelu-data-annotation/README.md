# 数据标注实训云

数据标注实训云是智慧未来学校发布的独立 iPolloWork 插件。用户安装后，可以在右侧工作台完成图片、视频、音频和文字标注，也可以从带文字层的 PDF 导入正文，或直接使用插件内置的实训项目。

## 使用方式

1. 在 iPolloWork 的扩展目录中安装“数据标注实训云”。
2. 在插件详情或对话中选择立即使用。
3. 在右侧工作台上传自己的素材，或选择已经配好素材和标签的实训项目。
4. 保存后，可以从“我的标注”继续编辑；对话侧仅在用户明确要求时只读查看已保存结果。

## 隔离边界

- 插件不会在未安装时注册 Skill、服务或工作台。
- 图片、视频、音频、PDF 解析和标注数据均在本机处理。
- 项目数据只写入当前工作区的插件专属目录。
- 卸载由 iPolloWork 插件生命周期统一移除该插件拥有的 Skill、服务和资源。
- 对话侧不会自动上传素材或修改右侧标注。

## 来源与许可

本插件使用 [OpenDataLab LabelU-Kit](https://github.com/opendatalab/labelU-Kit) 的标注组件，并使用 [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 提取 PDF 文字。二者均采用 Apache License 2.0。

本插件由智慧未来学校独立开发和发布，不是 OpenDataLab 或 Mozilla 的官方插件，也不代表其认可或背书。第三方许可与声明见 `LICENSE-THIRD-PARTY.txt` 和 `NOTICE.txt`；插件自身代码适用 iPolloWork 仓库根目录的许可证。

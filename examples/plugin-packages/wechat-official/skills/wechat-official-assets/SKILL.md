---
name: wechat-official-assets
description: Prepare selected workspace images and information cards as WeChat Official Account cover and article assets without reading outside the active workspace.
disable-model-invocation: false
---

# 公众号卡片与素材适配

用于把信息卡片、海报或工作区图片接入公众号图文。

1. 先列出用户指定的工作区图片与用途：封面、正文图片或外链落地页。
2. 只调用 `upload-cover-image` 或 `upload-article-image` 上传当前工作区内的明确文件；不得猜测或读取工作区外路径。
3. 返回微信生成的 media ID 或正文图片 URL，并记录它们将被放入哪一篇草稿。
4. 图片不适合、没有版权来源或不能解释用途时，先提示用户处理，不要擅自上传。

上传图片不等于发布文章；后续仍需创建草稿并经确认发布。

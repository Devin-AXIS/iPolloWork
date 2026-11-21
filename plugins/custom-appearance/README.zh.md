# 自定义外观

打开「设置 → 自定义外观」，填写应用名称，上传 PNG、JPEG 或 WebP Logo。保存后应用到侧栏、对话首页、网页或窗口标题及网页图标。Host 启动页也使用已保存的品牌。

点击预设即可切换。「我的皮肤」可分别保存浅色和深色的主题色、辅助色、文字颜色及背景颜色。浅色、深色和跟随系统仍由 DSH 原有模式设置决定。点击「套件默认」可恢复原配色，品牌和自定义配色仍可继续使用。

外观保存在当前 DSH Host profile，由 Host 所有者编辑。启动页使用限制大小的 PNG Logo。操作系统中的安装包名称和应用图标由安装包决定。

iPolloWork 套件内的子插件 ID 为 `ipollo-custom-appearance`。也可在独立 DSH profile 安装 `@ipollo/dsh-custom-appearance`。完成固定 DSH 准备后，在此目录执行 `npm ci`、`npm run check` 和 `npm run pack:check`。

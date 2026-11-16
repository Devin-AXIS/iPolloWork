# 两种交付方式

## iPolloWork 客户端

网站提供品牌客户端安装包。执行 `npm run setup:build`，再执行 `npm run package:desktop:mac:arm64 -- --unsigned --dir` 构建本地 macOS 版本。客户端内置同一个 `@ipollo/dsh-suite` 套件及固定版本的官方 DSH 运行时。系统名称、原生登录窗口和升级打包由这个客户端负责。

客户端启用 `@ipollo/desktop-host` 应用配置，通过官方 Include 插件加载共用的功能模块。DSH 会阻止停用、移除该应用配置，内部功能也不提供普通插件开关。客户端不再单独启用公共套件。这是应用配置，不防止用户编辑本地文件。

## 安装到 DSH 宿主的插件

执行 `npm run package:plugin` 生成 `dist/ipollo-dsh-suite-<version>.tgz` 和 `dist/plugin-release.json`。通过官方客户端的插件页面安装压缩包，或执行 `dsh plugin --profile <profile> add file:/absolute/path/to/ipollo-dsh-suite-<version>.tgz`。更新包后重启 profile。Web 部署在 DSH 服务端安装套件；纯浏览器网页不能安装 Host 插件。

插件提供应用内的 iPolloWork 品牌、账户与企业入口、精选市场、智能体、IM 和服务连接。系统名称、图标及原生欢迎窗口仍由宿主管理。0.1.25 已验证官方 0.2.2-rc.3 桌面发行包和固定的源码构建。插件沿用宿主认证：发行包的内置校验，或源码构建中按作用域注册的认证服务。

公共插件直接显示为 **iPolloWork**，允许通过宿主的官方插件管理器停用和卸载。停用会撤销界面及工具，不删除已保存的项目数据。

两种方式共用账户服务和插件源码。开发时下载官方依赖，不会把官方源码放入 Git，也不会把完整源码仓库复制进安装包。切换交付方式不产生第二套 Agent 引擎。

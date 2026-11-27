# WeChat Channels Operations

Native DSH bundle migrated from `wechat-channels-ops` 0.1.16. Install its .tgz through iPolloWork Market or the native DSH Plugin Manager. Choose a registered workspace before opening the workbench. Credentials use the native Host credential store; existing local business data is retained. Disable/uninstall releases tools, Skills, routes and child services while retaining data.

In iPolloWork Desktop with account login support, choose Add by QR code and scan the official code in WeChat. The workbench verifies the account on the Channels dashboard. Use Continue login or Check login to reuse an existing account session. If a local proxy delays the page and the desktop toolbar offers Retry directly, use it to reach the official WeChat login and its resources in the same account session.

Build with `npm run build`. Run `npm run check` and `npm run pack:check` before packaging. See the repository migration inventory for capability-specific verification and limitations.

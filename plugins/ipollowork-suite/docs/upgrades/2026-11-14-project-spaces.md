# Enterprise project collaboration

The service now migrates SQLite monotonically to version 5, preserving old shares, comments and result history. Back up the service data directory before upgrading. New writes to the legacy snapshot, comment and result endpoints return HTTP 410; use project submissions instead. Existing data is not deleted or converted into a live DSH share.

New project permission levels are View, Participate and Maintain. Existing enterprise-wide visibility is retained until a maintainer changes Access. New project forms explicitly choose their sharing scope. A member removed from the enterprise, or a department grant they leave, loses access on the next request. Project ownership changes clear prior project grants and revoke legacy snapshot links.

The suite now bundles DSH Liveshare. Deploy the matching `ipollowork-services` v5 server at `accountOrigin`, including its WebSocket upgrade route. Sharing authorizes the current iPollo account using native PKCE and binds each native link to a project. Project grants are now also authoritative for those links: revoked project/department access stops new requests and cancels open calls. Existing unrelated native shares are not imported. The native owner header action is replaced through slot priority, and restored when the suite is disabled. Forks remain on the sharing Host and do not create isolated local directories.

主项目维护文件版本和统一记忆。员工提交选中的文件或提炼的知识，维护者接纳；不再创建评论和成果发布记录。文件不会自动同步到本机，共享记忆在关联工作区的每一轮 AI 工作前重新鉴权并读取。原生会话共享使用独立账户服务内的兼容转发模块，部门和项目权限实时生效；不生成自建文字快照。

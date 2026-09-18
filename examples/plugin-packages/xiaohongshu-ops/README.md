# 小红书运营台

iPolloWork 插件集内置的小红书运营插件，源码位于 `examples/plugin-packages/xiaohongshu-ops`。插件 ID 保持 `xiaohongshu-ops`，已有安装、账号和草稿数据可以继续使用。

支持多账号独立浏览器登录、账号验证与数据同步、图文/视频草稿、素材导入、关键词找帖、评论候选、发布/评论记录，以及通过主软件会话和日程执行已授权操作。平台操作使用账号对应的可见浏览器会话；不会将预期账号、未观察的数据或不确定结果当作成功。

## 开发

需要 Node.js ≥22.22 和 pnpm。在 iPolloWork 仓库根目录运行：

```sh
pnpm --dir examples/plugin-packages/xiaohongshu-ops run setup
pnpm --dir examples/plugin-packages/xiaohongshu-ops run check
pnpm --dir examples/plugin-packages/xiaohongshu-ops test
pnpm --dir examples/plugin-packages/xiaohongshu-ops run build
pnpm --dir examples/plugin-packages/xiaohongshu-ops start
```

默认本地地址为 `http://127.0.0.1:4790`。`dev` 使用源码监视模式。账号、数据库和凭据属于运行数据，不随源码提交。直接启动默认写入 `skills/xhs-ops-worker/app/data`；通过插件启动时使用 `~/.ipollowork/plugin-data/xiaohongshu-ops`，可用 `XHS_OPS_DATA_DIR` 指定目录。主软件浏览器、AI 和日程操作需要安装后的宿主桥接。

## 接入 iPolloWork

根目录的 `ipollowork.plugin.json` 是原生插件清单，`service/workbench.mjs` 是宿主启动入口，`skills/` 包含工作技能和运行代码。开发环境从本目录读取插件；桌面安装包把运行所需的清单、服务和技能复制到 `plugin-packages/xiaohongshu-ops`。用户在主软件插件列表安装或更新，不需要生成外部本地插件包。

插件运行数据保存在用户数据目录，与源码和安装快照分离。从主软件右侧 **＋ → 小红书运营台** 打开。更新源码和插件版本不会删除账号、草稿或浏览器会话。

## 验证

单元测试、类型检查和构建由本目录的 pnpm 脚本负责。`evals/flows/`、`evals/voiceovers/` 保存插件界面验证流程。运行 `node examples/plugin-packages/xiaohongshu-ops/evals/run.mjs --list`，或为隔离测试应用指定 `--flow` 与 `--cdp-url`。模拟日程和发布流程还需按流程的 `requiredEnv` 配置隔离环境，不能对真实账号执行整套验证。

## 来源与许可

插件业务源码已归回 iPolloWork 插件集。原独立目录只作为迁移后的可恢复副本，不再是维护来源。许可及署名见 [LICENSE](LICENSE) 和 [历史 MIT 许可](LICENSES/MIT-legacy.txt)。账号、Cookie、凭据、数据库和运行制品不会随源码提交。

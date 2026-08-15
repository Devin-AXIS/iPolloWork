# DeepSeek Design

Native iPolloWork Design and PPT Studios for DeepSeek Harness.

This directory is the source of two independently installed plugins:

- [`deepseek-idesign`](https://www.npmjs.com/package/deepseek-idesign) — websites, app prototypes, posters,
  information cards, reports, magazines, and other non-slide designs.
- [`deepseek-ippt`](https://www.npmjs.com/package/deepseek-ippt) — presentations and slide templates only.

## Install

```sh
dsh plugin --profile web add deepseek-idesign
dsh plugin --profile web add deepseek-ippt
dsh --profile web
```

Install either package or both. Each one contains its browser assets and does
not install the iPolloWork desktop app.

## One source, two entry points

The iPolloWork repository is the only source of truth for product code. Every
change to the shared Design Studio is built once and flows to both DeepSeek
plugins. The public
[`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) repository is
an automatically generated distribution and contribution mirror: it provides
complete runnable packages, source references, issues, and a focused discovery
page without creating a second implementation to maintain.

## Contributing code

Open source pull requests in `deepseek-design` against `source/` or the root
README. Do not edit generated runtime files under `packages/` directly. After a
source change is merged there, iPolloWork imports it as a reviewable upstream
pull request. Merging the upstream pull request rebuilds both plugins and
synchronizes the result back to `deepseek-design`.

## License

These plugins use the same iPolloWork Source Available License as the main
repository. Third-party components and previously licensed portions retain
their respective licenses.

---

DeepSeek Design 将 iPolloWork 的 Design Studio 与 PPT Studio 作为两个可独立安装
的 DeepSeek Harness 插件提供。大家可以在 `deepseek-design` 的 `source/` 目录
提交代码；合并后会自动生成 iPolloWork 主库 PR。主库合并后再重新构建并同步
回来，因此始终只有一套官方源码。

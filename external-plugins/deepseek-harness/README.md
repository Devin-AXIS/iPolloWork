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
an automatically generated distribution mirror: it provides complete runnable
packages, source references, issues, and a focused discovery page without
creating a second implementation to maintain.

## License

These plugins use the same iPolloWork Source Available License as the main
repository. Third-party components and previously licensed portions retain
their respective licenses.

---

DeepSeek Design 将 iPolloWork 的 Design Studio 与 PPT Studio 作为两个可独立安装
的 DeepSeek Harness 插件提供。产品代码只在 iPolloWork 主库维护；公开的
`deepseek-design` 仓库由主库自动生成和同步，不会形成两套代码。

# DeepSeek iPPT

This bundle adds iPolloWork PPT Studio as a native `PPT` conversation view in
the DeepSeek Harness web app. The `+` beside Edit opens only the curated
iPolloWork slide catalog; websites, app prototypes, posters, reports, and Video
templates remain outside this package.

PPT projects stay isolated under `design/<sessionId>-ippt/`, so iPPT and
`deepseek-idesign` can be installed together without replacing each other's
files. Both packages use the same Studio implementation and template contract.

## Install

```sh
dsh plugin --profile web add deepseek-ippt
dsh --profile web
```

For a local release artifact:

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-ippt-0.1.1.tgz
```

# DeepSeek iDesign

This bundle adds the existing iPolloWork Design Studio as a native `Design`
conversation view in the DeepSeek Harness web app. Design files stay in the
active Harness workspace under `design/<sessionId>/`; selected elements can be
sent into the current conversation draft without automatically submitting it.

## Install

Install the published package into the web profile and start Harness normally:

```sh
dsh plugin --profile web add deepseek-idesign
dsh --profile web
```

For a local release artifact:

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-idesign-0.1.0.tgz
```

The plugin contains its own browser assets. It does not install or start the
iPolloWork desktop application, and it does not load Video Studio.

## Data boundary

The host bridge accepts only the workspace registered by DeepSeek Harness and
only paths below its `design/` directory. Writes use conflict checks and atomic
replacement. The Studio iframe receives a per-process token; selecting
`Ask AI` stages a draft for the user to review and never submits it itself.

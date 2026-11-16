# iPolloWork desktop host

English | [中文](README.zh.md)

This private package provides the Electron IPC handoff and invokes the official DSH profile launcher. It does not implement an Agent loop, model scheduler or session format. DSH imports resolve from the same pinned official source build as [the desktop shell](../desktop/README.md).

The package name is `@ipollo/desktop-host`. The desktop packaging command builds and includes it automatically. Account, onboarding and sharing belong to the separate iPolloWork suite. The source derives from the official DeepSeek Harness Desktop Host under the MIT license retained in `LICENSE`.

Its native application bundle uses the official Include plugin to mount the shared iPolloWork modules from `application.yml`. `integrations/tooling/desktop-composition.mjs` generates that list from the public bundle, enabling `dedicatedDesktop` for this client only. The launcher supplies the installed file path as a final overlay. DSH's existing manager protects the Include carrier and treats its nested modules as application-owned; the manager service itself is unchanged.

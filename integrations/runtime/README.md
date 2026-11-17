# Official DSH dependency

English | [中文](README.zh.md)

`upstream.json` fixes the official source revision, source archive SHA-256 and npm release identity. The branded desktop is built from this source revision. The public plugin is also tested with the official 0.2.2-rc.3 desktop release; its authentication API is selected from the host exports.

Run `npm run setup:build` at the product repository root. The source is downloaded into `.upstream/dsh`; ignored local links support existing TypeScript and build imports. No official source file is copied into the tracked product tree or modified by setup. Git metadata lives in the cache only, so the official build can identify its own revision independently of product history.

`npm run check:upstream` checks original source hashes and rejects tracked upstream implementation directories. `node check-pin.mjs` checks the downloaded source from this directory. Existing files and sessions are outside this dependency cache.

See the [DSH compatibility record](compatibility.md) for product integrations, upstream interfaces that may change, and the upgrade verification steps.

The official npm distribution can be examined separately with `npm ci --ignore-scripts` here. It is not used to mix or replace individual packages inside the source-built desktop graph.

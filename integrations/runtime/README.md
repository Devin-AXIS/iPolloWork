# Official DSH dependency

English | [中文](README.zh.md)

`upstream.json` fixes the official source revision, source archive SHA-256 and npm release identity. The current baseline is **0.2.3-alpha.2**, requiring Node.js **^24.22.3 or >=26.13.1** and pnpm **11.28.5**. The branded desktop is built from that source revision, with matching SDK and Cordis dependencies.

Run `npm run setup:build` at the product repository root. The source is downloaded into `.upstream/dsh`; ignored local links support existing TypeScript and build imports. No official source file is copied into the tracked product tree or modified by setup. Git metadata lives in the cache only, so the official build can identify its own revision independently of product history.

For an existing development checkout containing legacy user files under `apps` or `packages`, add `--staged` during setup and use `integrations/desktop/scripts/start-local-hot.ps1 -Restart` for the existing development profile. This keeps those directories and builds the product shell in its ignored source stage. Fresh checkouts and release CI use the normal resolution links.

When changing an existing pin, close the development application and run `npm run setup:build -- --upgrade-upstream`. Setup first verifies the previous source, stages the new release, and retains the previous cache for recovery. It refuses a silent replacement or modified official source. Profiles, credentials, sessions and workspace files remain outside the cache. Windows uses a verified Git checkout and managed configuration copies, without requiring file symlink privileges. Portable runtime checks use a temporary short junction to avoid MAX_PATH failures; the payload and official checks remain unchanged.

Run `npm test` and `npm run check:upstream`, then package and install the actual archives in a disposable profile. The runtime contract checks the desktop Host identity, reviewed plugin engines and official SDK versions. Recheck Design and Video archives as well as product source; changing a compatibility range alone does not establish compatibility.

Design and Video are rebuilt from the immutable external source recorded in `studios.json`. Clone that repository, check out its exact `sourceRevision`, and run `npm run prepare:studios -- <checkout>` here. The helper verifies the clean source, runtime pin and `studio-alpha2.patch` checksum before applying the reviewed SDK metadata/lock adaptation. In that checkout run `npm ci`, `npm run check`, `npm run pack:plugins` and the independent/combined native smoke. Import those actual archives with the Suite catalog helper and re-run `check:upstream`; the archive hashes and receipt are release inputs. Do not edit the official DSH cache.

`npm run check:upstream` checks original source hashes and rejects tracked upstream implementation directories. `node check-pin.mjs` checks the downloaded source from this directory. Existing files and sessions are outside this dependency cache.

See the [DSH compatibility record](compatibility.md) for product integrations, upstream interfaces that may change, and the upgrade verification steps.

The official npm distribution can be examined separately with `npm ci --ignore-scripts` here. It is not used to mix or replace individual packages inside the source-built desktop graph.

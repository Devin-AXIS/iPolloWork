// What `module` resolves to inside the shipped bundle.
//
// The HarfBuzz runtime's Emscripten glue opens with, in one file serving both runtimes:
//
//   if (ENVIRONMENT_IS_NODE) { const { createRequire } = await import("module"); … }
//
// The guard is false in a browser, but the specifier still has to RESOLVE, and a browser
// bundler has nothing to resolve it to. Webpack's Next.js client config stubs `assert`,
// `buffer`, `crypto`, `path` and a dozen more — not `module`; Turbopack stubs no builtin at
// all. Both fail the build outright:
//
//   Module not found: Can't resolve 'module'
//
// Which is a build error every consumer of this package would have to answer for
// themselves, in a config file, for a branch their code never runs (#282). So the bundle
// carries harfbuzzjs INLINE with this file aliased over `module`: nothing named `module` is
// left to resolve, and no host needs a `resolve.fallback` or a `turbopack.resolveAlias`.
//
// It still has to be RIGHT under Node, where that branch does run and the runtime reads the
// `.wasm` off disk through the `require` it builds here. `process.getBuiltinModule` reaches
// the real builtin with no specifier for a bundler to see (Node 20.16+ / 22.3+), so one
// bundle serves both: the browser never calls this, and Node gets the genuine article.

interface NodeModuleBuiltin {
  createRequire(path: string | URL): (id: string) => unknown;
}

function nodeModuleBuiltin(): NodeModuleBuiltin | undefined {
  const runtime = globalThis.process as { getBuiltinModule?: (id: string) => unknown } | undefined;
  if (typeof runtime?.getBuiltinModule !== 'function') return undefined;
  return runtime.getBuiltinModule('module') as NodeModuleBuiltin;
}

/**
 * Node's `module.createRequire`, or a thrower off Node.
 *
 * Reached only from the runtime's `ENVIRONMENT_IS_NODE` branch, so the throw is unreachable
 * in a browser. It is a loud one rather than a silent stub because a Node build that lands
 * here has lost its file access, and shaping would fail later with a stranger message.
 */
export function createRequire(path: string | URL): (id: string) => unknown {
  const builtin = nodeModuleBuiltin();
  if (!builtin) {
    throw new Error(
      "createRequire is unavailable: this build reaches Node's `module` through " +
        'process.getBuiltinModule, which needs Node 20.16+ or 22.3+.'
    );
  }
  return builtin.createRequire(path);
}

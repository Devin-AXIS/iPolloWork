import type { UiRuntime } from './runtime';

// Keep this boundary free of React imports: production plugins use the host copy.
export function requireRuntime(major = 1): UiRuntime {
  const runtime = window.ipolloworkUi;
  if (!runtime || Number(runtime.version.split('.')[0]) !== major) throw new Error('组件运行时不兼容，请更新 iPolloWork 客户端后重新打开插件。');
  return runtime;
}

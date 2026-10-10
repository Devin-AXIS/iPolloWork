import type { UiRuntime } from './runtime';

// Keep this boundary free of React imports: production plugins use the host copy.
export function requireRuntime(major = 1, required: readonly (keyof UiRuntime)[] = [], minimumMinor = 0): UiRuntime {
  const runtime = window.ipolloworkUi;
  if (!runtime || Number(runtime.version.split('.')[0]) !== major) throw new Error('组件运行时不兼容，请更新 iPolloWork 客户端后重新打开插件。');
  const minor = Number(runtime.version.split('.')[1]);
  if (!Number.isInteger(minor) || minor < minimumMinor) throw new Error('客户端 UI 版本过旧，请更新 iPolloWork 客户端后重新打开插件。');
  if (required.some(name => typeof runtime[name] !== 'function')) throw new Error('客户端缺少所需 UI 组件，请更新 iPolloWork 客户端后重新打开插件。');
  return runtime;
}

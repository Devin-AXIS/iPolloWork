/** Use the current native UI exposed to this owned same-origin workbench. */
export function requireRuntime(): unknown {
  const runtime: unknown = Reflect.get(window.parent, '__ipolloPortedUi')
  if (!runtime) throw new Error('请从 iPolloWork 短片工作台打开')
  return runtime
}

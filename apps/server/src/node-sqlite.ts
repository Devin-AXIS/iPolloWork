let nodeSqlitePromise: Promise<typeof import("node:sqlite")> | null = null;

export function importNodeSqlite(): Promise<typeof import("node:sqlite")> {
  nodeSqlitePromise ??= loadNodeSqlite();
  return nodeSqlitePromise;
}

async function loadNodeSqlite(): Promise<typeof import("node:sqlite")> {
  const originalEmitWarning = process.emitWarning;
  const emitWarningWithoutSqliteNoise = (
    warning: string | Error,
    optionsOrType?: string | NodeJS.EmitWarningOptions | Function,
    codeOrCtor?: string | Function,
    ctor?: Function,
  ) => {
    const warningType =
      typeof optionsOrType === "string"
        ? optionsOrType
        : typeof optionsOrType === "function"
          ? undefined
          : optionsOrType?.type;
    if (warningType === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
    Reflect.apply(originalEmitWarning, process, [warning, optionsOrType, codeOrCtor, ctor]);
  };

  process.emitWarning = emitWarningWithoutSqliteNoise as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

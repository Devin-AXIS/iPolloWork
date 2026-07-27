import { execFileSync as runProcess } from "node:child_process";

/**
 * @typedef {object} SystemFontCatalogOptions
 * @property {string} [platform]
 * @property {(command: string, args: string[], options: object) => string} [execFileSync]
 */

export const FALLBACK_SYSTEM_FONT_FAMILIES = [
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

export function normalizeSystemFontFamilies(fonts) {
  const unique = new Map();

  for (const value of fonts) {
    const font = String(value ?? "")
      .trim()
      .replace(/\s+\((?:TrueType|OpenType)\)\s*$/i, "");
    if (!font || /[\\/]/.test(font) || /\.(?:fon|otf|ttc|ttf)$/i.test(font)) continue;

    const key = font.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, font);
  }

  return [...unique.values()].sort((left, right) => left.localeCompare(right));
}

/** @param {SystemFontCatalogOptions} [options] */
export function listSystemFontFamilies(options = {}) {
  const platform = options.platform ?? process.platform;
  const execFileSync = options.execFileSync ?? ((command, args, processOptions) => String(runProcess(command, args, processOptions)));
  if (platform !== "win32") return FALLBACK_SYSTEM_FONT_FAMILIES;

  const script = [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "$fonts = (New-Object -ComObject Shell.Application).Namespace(0x14)",
    "$fonts.Items() | ForEach-Object { $fonts.GetDetailsOf($_, 0) }",
  ].join("; ");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  return normalizeSystemFontFamilies(output.split(/\r?\n/));
}

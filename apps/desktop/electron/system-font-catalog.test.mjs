import assert from "node:assert/strict";
import test from "node:test";

import {
  listSystemFontFamilies,
  normalizeSystemFontFamilies,
} from "./system-font-catalog.mjs";

test("normalizes Windows display names without paths or duplicates", () => {
  assert.deepEqual(
    normalizeSystemFontFamilies([
      " Arial ",
      "arial",
      "Noto Sans (TrueType)",
      "C:\\Windows\\Fonts\\not-a-font-name.ttf",
      "",
      null,
    ]),
    ["Arial", "Noto Sans"],
  );
});

test("uses the Windows Fonts shell namespace and returns only font families", () => {
  const calls = [];
  const fonts = listSystemFontFamilies({
    platform: "win32",
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      return "Arial\r\nArial\r\nNoto Sans (TrueType)\r\n";
    },
  });

  assert.deepEqual(fonts, ["Arial", "Noto Sans"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.match(calls[0].args.at(-1), /Shell\.Application/);
  assert.match(calls[0].args.at(-1), /\$OutputEncoding\s*=\s*\[Console\]::OutputEncoding/);
  assert.equal(calls[0].options.windowsHide, true);
});

test("uses a stable fallback catalog outside Windows", () => {
  assert.deepEqual(
    listSystemFontFamilies({
      platform: "linux",
      execFileSync() {
        throw new Error("must not run");
      },
    }),
    ["Arial", "Courier New", "Georgia", "Helvetica", "Times New Roman", "Trebuchet MS", "Verdana"],
  );
});

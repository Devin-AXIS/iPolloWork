import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { encodeWindowsIcon, WINDOWS_ICON_SIZES } from "../electron/brand-icon-windows.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

// Transport-only assets. Never modify the signed plugin archives for Explorer.
export async function pluginPackageIconFiles() {
  const source = await readFile(new URL("../../app/public/sidebar-icon/plugin.svg", import.meta.url));
  const entries = await Promise.all(WINDOWS_ICON_SIZES.map(async size => ({
    size, png: await sharp(source, { density: 96 * size / 16 }).resize(size, size).png().toBuffer(),
  })));
  const files = new Map([
    ["plugin-package.ico", encodeWindowsIcon(entries)],
    ["plugin-package-icons.ps1", await readFile(new URL("./plugin-package-icons.ps1", import.meta.url))],
  ]);
  for (const [name, action] of [["Enable-plugin-icons.cmd", "Enable"], ["Restore-plugin-icons.cmd", "Restore"]]) {
    files.set(name, Buffer.from(`@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0plugin-package-icons.ps1" -Action ${action}\r\nif errorlevel 1 (\r\n  echo [FAILED] Plugin file icons could not be changed.\r\n  pause\r\n  exit /b 1\r\n)\r\necho [OK] Refresh the folder to see the updated file icons.\r\npause\r\n`));
  }
  files.set("README-icons.txt", Buffer.from("Windows 插件安装包图标\r\n\r\n解压整个集合，然后双击 Enable-plugin-icons.cmd，只需运行一次，无需管理员权限。\r\n所有 .ipollowork-plugin 安装包会使用软件中的拼图图标。若文件夹已打开，请刷新。\r\n图标复制到本机固定目录，之后移动插件包或删除此集合都不会影响图标。\r\n需要还原时双击 Restore-plugin-icons.cmd；原有文件打开方式保持不变。\r\n其他电脑也需运行一次启用脚本；仅上传插件包到云端不会自动更改 Windows 图标。\r\n上传云端时只选择 .ipollowork-plugin 文件，图标和脚本无需上传。\r\n安装包内容、签名、版本及 SHA-256 不受此设置影响。\r\n", "utf8"));
  return files;
}

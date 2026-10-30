import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginPackageIconFiles } from "../../apps/desktop/scripts/plugin-package-icons.mjs";

const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const sharp = require("sharp");
const JSZip = createRequire(new URL("../../apps/app/package.json", import.meta.url))("jszip");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export default {
  id: "plugin-package-file-icon", title: "Windows plugin archive icons preserve signed cloud packages", kind: "internal", requiresApp: false,
  steps: [{ name: "Windows returns the app's plugin icon for every unchanged signed archive", run: async ctx => {
    await ctx.prove("All twenty signed archives display the existing app plugin icon through the real Windows Shell", {
      voiceover: "启用后，Windows 文件夹中的插件安装包统一显示软件里的拼图图标；二十个安装包的内容和签名保持原样。",
      assert: async () => {
        ctx.assert(process.platform === "win32", "Native Windows Shell proof requires Windows");
        const folder = process.env.IPOLLOWORK_PLUGIN_RELEASE_PROOF_DIR;
        ctx.assert(Boolean(folder), "Set IPOLLOWORK_PLUGIN_RELEASE_PROOF_DIR to the extracted collection after enabling icons");
        const collection = JSON.parse(await readFile(join(folder, "collection.json"), "utf8"));
        ctx.assert(collection.signed === true && collection.plugins.length === 20, "Twenty signed release packages are present");
        const zipBytes = await readFile(join(folder, "plugins-collection.zip"));
        const zip = await JSZip.loadAsync(zipBytes);
        ctx.assert((await readFile(join(folder, "plugins-collection.zip.sha256"), "utf8")).startsWith(digest(zipBytes) + "  "), "Transport ZIP matches its digest");
        for (const plugin of collection.plugins) {
          ctx.assert(digest(await readFile(join(folder, plugin.artifact.file))) === plugin.artifact.sha256, "Signed file bytes preserved: " + plugin.pluginId);
          ctx.assert(digest(await zip.file(plugin.artifact.file).async("nodebuffer")) === plugin.artifact.sha256, "Transport preserves signed file bytes: " + plugin.pluginId);
        }
        const assets = await pluginPackageIconFiles();
        for (const [name, bytes] of assets) {
          ctx.assert(bytes.equals(await readFile(join(folder, name))), "Current icon tooling delivered: " + name);
          ctx.assert(bytes.equals(await zip.file(name).async("nodebuffer")), "Icon tooling included in transport: " + name);
        }
        const ico = assets.get("plugin-package.ico");
        const entry = 6 + 2 * 16; // The existing ICO encoder's 32px representation.
        const offset = ico.readUInt32LE(entry + 12);
        const expected = await sharp(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8))).raw().toBuffer();
        const native = spawnSync("powershell.exe", ["-NoProfile", "-Command", String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FileIconWitness {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Info {
    public IntPtr icon; public int index; public uint attributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string type;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attributes, ref Info info, uint size, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
$results = foreach ($file in Get-ChildItem -LiteralPath $env:IPOLLOWORK_PLUGIN_RELEASE_PROOF_DIR -Filter '*.ipollowork-plugin') {
  $info = New-Object FileIconWitness+Info
  $status = [FileIconWitness]::SHGetFileInfo($file.FullName, 0, [ref]$info, [Runtime.InteropServices.Marshal]::SizeOf($info), 0x100)
  if ($status -eq [IntPtr]::Zero -or $info.icon -eq [IntPtr]::Zero) { throw "No native icon: $($file.Name)" }
  $icon = [Drawing.Icon]::FromHandle($info.icon); $bitmap = $icon.ToBitmap(); $stream = New-Object IO.MemoryStream
  try {
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    @{ file = $file.Name; png = [Convert]::ToBase64String($stream.ToArray()) }
  } finally { $stream.Dispose(); $bitmap.Dispose(); $icon.Dispose(); [FileIconWitness]::DestroyIcon($info.icon) | Out-Null }
}
$results | ConvertTo-Json -Compress
`], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
        ctx.assert(native.status === 0, "Native Shell extraction succeeds: " + native.stderr);
        const icons = JSON.parse(native.stdout);
        ctx.assert(icons.length === 20, "Windows returned icons for all twenty archives");
        for (const icon of icons) {
          const actual = await sharp(Buffer.from(icon.png, "base64")).raw().toBuffer();
          // Windows premultiplied-alpha conversion may round a channel by one.
          ctx.assert(actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= 1), "Native file icon matches app plugin SVG: " + icon.file);
        }
        ctx.output("Windows Shell witness", JSON.stringify({ files: icons.map(icon => icon.file), nativeIconsMatchAppPluginIcon: true, signedArchiveBytesPreserved: true, transportSha256: digest(zipBytes) }, null, 2));
        ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Twenty native Shell icons match the app plugin SVG, and all twenty signed archive digests remain unchanged" });
      },
    });
  } }],
};

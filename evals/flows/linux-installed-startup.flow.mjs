import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

export default {
  id: "linux-installed-startup",
  title: "A desktop user opens the installed Ubuntu application with its sandbox enabled",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_INSTALLED_LINUX"],
  steps: [
    {
      name: "The installed application opens without manual permission repair",
      run: async (ctx) => {
        await ctx.prove("A regular user can open the installed application when unprivileged user namespaces are disabled", {
          voiceover: "安装完成后直接打开 iPollo，应用正常显示，不需要再手动修改权限。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "installed application control API" });
            await ctx.waitFor(`!document.querySelector('#ipollowork-startup-splash, [data-testid="startup-logo-animation"], [data-testid="session-loading-animation"]')`, { timeoutMs: 60_000, label: "startup loading screens removed" });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="main-workspace"]')?.getClientRects().length)`, { label: "main workspace visible" });
            await ctx.waitFor("document.body.innerText.trim().length > 40 && Boolean(document.querySelector('button, a, input'))", { label: "usable application window" });
          },
          assert: async () => {
            ctx.assert(process.platform === "linux" && process.getuid() !== 0, "Startup proof must run as a regular Linux user");
            ctx.assert(readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf8").trim() === "0", "The regression environment must restrict unprivileged user namespaces");
            const helper = statSync("/opt/iPollo/chrome-sandbox");
            ctx.assert(helper.uid === 0 && helper.gid === 0 && (helper.mode & 0o7777) === 0o4755, "The installed Chromium sandbox helper must be root:root with mode 4755");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Installed sandbox ownership and mode are root:root / 4755", actual: { uid: helper.uid, gid: helper.gid, mode: (helper.mode & 0o7777).toString(8) } });
            const icon = '/opt/iPollo/resources/icons/icon.png';
            const hash = bytes => createHash('sha256').update(bytes).digest('hex');
            ctx.assert(hash(readFileSync(icon)) === hash(readFileSync(new URL('../../apps/desktop/resources/icons/icon.png', import.meta.url))), 'The installed runtime includes the application logo');
            const desktopFile = readdirSync('/usr/share/applications').find(name => name.includes('ipollowork') && name.endsWith('.desktop'));
            ctx.assert(desktopFile, 'The application has an installed desktop launcher');
            const { extractFile } = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))('@electron/asar');
            const metadata = JSON.parse(extractFile('/opt/iPollo/resources/app.asar', 'package.json').toString());
            ctx.assert(metadata.desktopName === desktopFile, 'The Wayland application identity matches its installed desktop launcher');
            const desktop = readFileSync('/usr/share/applications/' + desktopFile, 'utf8');
            const iconName = desktop.match(/^Icon=(.+)$/m)?.[1];
            ctx.assert(iconName && readdirSync('/usr/share/icons/hicolor').some(size => existsSync('/usr/share/icons/hicolor/' + size + '/apps/' + iconName + '.png')), 'The launcher references an installed theme icon');
            const processes = readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(pid => {
              try {
                const args = readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
                if (!/^\/(usr\/bin|opt\/iPollo)\/@ipolloworkdesktop$/.test(args[0]) || args.some(arg => arg.startsWith('--type='))) return [];
                const environment = readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0');
                const display = environment.find(value => value.startsWith('DISPLAY='))?.slice(8);
                const authority = environment.find(value => value.startsWith('XAUTHORITY='))?.slice(11);
                return display ? [{ pid: Number(pid), display, authority }] : [];
              } catch { return []; } // Processes can exit while /proc is read.
            });
            ctx.assert(processes.length > 0, 'The installed Electron application has a native display');
            let nativeIcon;
            for (const process of processes) {
              const env = { ...globalThis.process.env, DISPLAY: process.display, ...(process.authority ? { XAUTHORITY: process.authority } : {}) };
              const tree = execFileSync('xwininfo', ['-root', '-tree'], { env, encoding: 'utf8' });
              for (const match of tree.matchAll(/^\s*(0x[0-9a-f]+)\s/gmi)) {
                const properties = execFileSync('xprop', ['-id', match[1], '-f', '_NET_WM_ICON', '32c', '-len', '32', '_NET_WM_ICON', 'WM_CLASS', '_NET_WM_PID'], { env, encoding: 'utf8' });
                const dimensions = properties.match(/_NET_WM_ICON\(CARDINAL\) = (\d+), (\d+)/);
                if (dimensions && Number(properties.match(/_NET_WM_PID\(CARDINAL\) = (\d+)/)?.[1]) === process.pid) {
                  nativeIcon = { width: Number(dimensions[1]), height: Number(dimensions[2]), wmClass: properties.match(/^WM_CLASS.+$/m)?.[0], launcherClass: desktop.match(/^StartupWMClass=(.+)$/m)?.[1] };
                  break;
                }
              }
              if (nativeIcon) break;
            }
            ctx.assert(nativeIcon?.width > 0 && nativeIcon?.height > 0, 'The running Linux window exposes its application icon to the desktop');
            ctx.assert(nativeIcon.wmClass?.toLowerCase().includes(nativeIcon.launcherClass?.toLowerCase()), 'The desktop launcher matches the running window class');
            ctx.recordEvidence({ type: 'assertion', status: 'passed', assertion: 'Linux launcher and running window both expose the packaged application logo', actual: nativeIcon });
            const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
            ctx.assert(typeof route === "string" && route.length > 0, "The installed application must report an active route");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "The installed application has rendered its initial route", actual: route });
          },
          screenshot: { name: "installed-ubuntu-app", rejectText: ["Loading...", "Something went wrong", "SUID sandbox helper binary"] },
        });
      },
    },
  ],
};

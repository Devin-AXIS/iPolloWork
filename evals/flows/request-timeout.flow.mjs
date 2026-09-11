import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "request-timeout",
  title: "Client deadlines preserve transport behavior and cover real SDK OAuth paths",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Verify request deadlines, uploads, cancellation and local HTTP",
    async run(ctx) {
      let result;
      await ctx.prove("Client transport regression checks pass, including real loopback HTTP", {
        voiceover: "这里验证请求成功、超时、取消和上传的数据，以及登录需要的较长等待时间；其中本地请求连接真实 HTTP 服务，外部登录和桌面 IPC 使用受控输入验证。",
        action: async () => {
          result = spawnSync("bun", ["test", "tests/request-timeout.test.ts"], {
            cwd: fileURLToPath(new URL("../../apps/app/", import.meta.url)),
            encoding: "utf8", timeout: 55000, windowsHide: true,
          });
          ctx.output("Client transport checks", `${result.stdout}\n${result.stderr}`);
        },
        assert: async () => {
          ctx.assert(result.status === 0, result.error?.message ?? "Transport checks completed successfully");
          const output = `${result.stdout}\n${result.stderr}`;
          ctx.assert(/\b[1-9]\d* pass\b/.test(output) && /\b0 fail\b/.test(output), "Transport cases ran and all passed");
        },
      });
    },
  }],
};

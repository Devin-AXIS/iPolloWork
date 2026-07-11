import { execSync } from "node:child_process";

execSync("pnpm --filter @ipollowalk/desktop build", { stdio: "inherit" });

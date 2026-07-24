import { execSync } from "node:child_process";

execSync("pnpm --filter @ipollowork/desktop build", { stdio: "inherit" });

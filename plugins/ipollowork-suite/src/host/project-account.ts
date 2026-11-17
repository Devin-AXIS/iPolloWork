/** The official account domain moved; existing project links remain valid on that service. */
import { SuiteError } from "./errors.ts";

function accountOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    // A link is an origin, never a URL with credentials, a path, query or fragment.
    if (url.href !== url.origin + "/") return undefined;
    return url.origin === "https://work.ipollo.net"
      ? "https://cloud.ipollo.net"
      : url.origin;
  } catch {
    return undefined;
  }
}

/** Only the known official migration is an alias; unrelated deployments stay isolated. */
export function matchesProjectAccount(linkOrigin: string, currentOrigin: string): boolean {
  const linked = accountOrigin(linkOrigin);
  return linked !== undefined && linked === accountOrigin(currentOrigin);
}

export class ProjectAccountMismatch extends SuiteError {
  constructor() {
    super("IPW_PROJECT_ACCOUNT_MISMATCH", 403);
    this.message = "此项目绑定了其他账号服务。请切换回原服务，或在组织空间中重新关联项目后重试。（IPW_PROJECT_ACCOUNT_MISMATCH）";
  }
}

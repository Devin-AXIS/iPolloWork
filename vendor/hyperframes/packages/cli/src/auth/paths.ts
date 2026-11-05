/**
 * Filesystem layout for the shared HeyGen credential store. Mirrors
 * `heygen-cli/internal/paths/paths.go` so both CLIs read the same file.
 * `HEYGEN_CONFIG_DIR` overrides the directory.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Filename for the credential store. Matches heygen-cli (no `.json`
 * suffix) so a `~/.heygen/credentials` written by either CLI is
 * readable by the other — see `heygen-cli/internal/auth/file_resolver.go`.
 */
export const CREDENTIAL_FILENAME = "credentials";

export function configDir(): string {
  const override = process.env["HEYGEN_CONFIG_DIR"];
  if (override && override.length > 0) return override;
  return join(homedir(), ".heygen");
}

export function credentialPath(): string {
  return join(configDir(), CREDENTIAL_FILENAME);
}

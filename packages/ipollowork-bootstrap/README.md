# iPolloWork Bootstrap CLI

Script-installable `ipollowork-bootstrap` command for agent-first onboarding.

This package is intentionally small and does not assume npm is the install
channel. A bootstrap script can place `bin/ipollowork.mjs` on disk, then run:

```bash
ipollowork-bootstrap install --bin-dir ~/.local/bin --install-dir ~/.ipollowork/bootstrap
ipollowork-bootstrap doctor --json
ipollowork-bootstrap install app --manifest https://example.com/ipollowork-install-manifest.json
ipollowork-bootstrap doctor --app --json
IPOLLOWORK_OWNER_PASSWORD='<generated-password>' ipollowork-bootstrap cloud onboard --base-url https://den.example.com --owner-email ada@example.com --org-name 'Ada Workspace' --invite-email teammate@example.com --skill-name 'First skill' --json
```

Current scope:

- `install` installs the lightweight CLI into a user-writable bin directory.
- `install app` downloads a manifest-selected desktop app artifact, verifies its
  SHA-256 digest, and installs it into a user-writable app directory.
  Supported artifact types: macOS `.dmg`, `.zip`, `.tar.gz`/`.tgz`, Linux
  `.AppImage`, and Windows `.exe`/`.msi` copy-installs.
- `doctor` verifies the CLI install and, optionally, a Den API health endpoint.
- `cloud onboard` drives the headless REST onboarding flow: sign up, sign in,
  create an org, invite a teammate, and create a starter skill.

This is a bootstrap layer; it does not replace the existing orchestrator CLI yet.

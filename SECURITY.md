# Security Policy

## Supported versions

iPolloWork is under active development. Security fixes are prioritized for the
latest stable release and the active development branch. Older versions are not
maintained indefinitely; users should upgrade to the latest release unless a
release note explicitly says that a security fix was backported.

| Version line | Security support |
| --- | --- |
| Latest GitHub release | Supported |
| Active `main`/`dev` development branches | Supported for pre-release fixes |
| Older releases | Upgrade to the latest release |

If an upgrade requires manual action, the release notes for the new version will
describe the changed interfaces, migration steps, or known compatibility risks.

## Security expectations

iPolloWork is a local-first desktop and server workspace for agentic work. Users
can expect the project to:

- keep local workspace files under the user's control and ask for explicit
  permission before privileged filesystem or external actions;
- store credentials, dynamic tokens, and private keys separately from ordinary
  configuration where the product handles them;
- avoid logging secrets, bearer tokens, API keys, private keys, and OAuth
  client secrets;
- validate untrusted input at process, API, workspace, plugin, package, and
  filesystem boundaries;
- use HTTPS/TLS for remote service communication in production deployments and
  verify TLS certificates by default;
- avoid cryptographic algorithms with known serious weaknesses for default
  security mechanisms;
- make local development defaults local-only and clearly separate them from
  production deployment guidance.

Users should not expect iPolloWork to sandbox every native tool, plugin, browser
extension, model provider, or command that they explicitly authorize to run as
their operating-system user. See `docs/security-model.md` for the threat model,
trust boundaries, and assurance case.

## Reporting a vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Instead, report vulnerabilities privately to:

- Subject: `[iPolloWork security] <short summary>`

Please include:

- A clear description of the issue
- Reproduction steps or proof of concept
- Impact assessment
- Suggested remediation (if known)

## Response expectations

- We will acknowledge receipt within 3 business days.
- We will provide an initial triage status within 7 business days.
- We will assess severity, affected versions, exploitability, and whether an
  emergency mitigation or coordinated release is required.
- We will keep the reporter updated when a fix, mitigation, or public advisory
  is ready.
- We will credit reporters in the release note or advisory unless they request
  anonymity. If no vulnerabilities were resolved in the last 12 months, this
  credit rule is not applicable for that period.

## Disclosure guidance

Please keep details private until a fix or mitigation is available and maintainers
confirm public disclosure timing.

## Release integrity

Official releases are published from the GitHub release workflow after release
verification succeeds. Local packages are for development testing and must not
be presented as official releases unless they were produced with the appropriate
signing credentials and release verification.

See [Release integrity](docs/release-integrity.md) for the current coverage,
release signing, and checksum verification process.

Release managers should:

- create annotated, signed Git tags for public major, minor, patch, and security
  releases when signing keys are available;
- publish release artifacts only from GitHub Actions release workflows;
- sign and notarize macOS artifacts with Apple Developer ID before public use;
- sign Windows installers through the configured Windows signing service before
  public use;
- publish checksums or signature materials with the release assets;
- document any temporary unsigned artifact in the release notes.

Users can verify release integrity by:

1. Downloading installers only from
   `https://github.com/Devin-AXIS/iPolloWork/releases`.
2. Checking that the release tag and release notes match the version they
   intend to install.
3. On macOS, confirming Gatekeeper accepts the app and `spctl --assess --type
   execute --verbose /Applications/iPollo.app` reports an accepted Developer ID
   signature.
4. On Windows, checking the installer signature in file properties or with
   `Get-AuthenticodeSignature`.
5. Comparing published checksums or signatures when they are provided for a
   release.

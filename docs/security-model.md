# iPolloWork Security Model

This document records the security expectations, threat model, trust
boundaries, and assurance case for iPolloWork.

## Security Goals

iPolloWork should:

- keep local workspace files under user control;
- require explicit user approval before privileged filesystem, shell, browser,
  network, or account-connected actions;
- keep credentials and private keys separate from ordinary configuration and
  logs;
- validate untrusted input before it crosses process, API, workspace, plugin,
  package, or filesystem boundaries;
- use secure transport for production remote communication;
- preserve the upstream OpenCode boundary instead of silently forking or
  weakening it;
- make release provenance, signing status, and unsupported local builds clear to
  users.

## Non-Goals

iPolloWork does not claim that:

- every user-approved command, plugin, browser extension, model provider, or
  native tool is sandboxed from the user's operating-system account;
- local development builds are production-hardened releases;
- self-hosted deployments are secure without operator-managed TLS, secrets,
  backups, logging, and access controls;
- third-party model providers or connected services are covered by iPolloWork's
  own security controls after a user authorizes data to be sent to them.

## Trust Boundaries

Important boundaries include:

- desktop renderer to Electron main process;
- Electron desktop to local iPolloWork server;
- local iPolloWork server to OpenCode sidecar;
- local workspace files to generated artifacts;
- plugin package metadata to installed executable plugin code;
- browser automation and extension surfaces to external websites;
- local runtime to iPolloCloud or a self-hosted Cloud deployment;
- Cloud control plane to hosted workers, databases, object storage, OAuth/SSO
  providers, and external model providers.

Data crossing these boundaries should be parsed, validated, scoped, and logged
without secrets.

## Input Validation

Server and desktop code should treat these as untrusted:

- HTTP request bodies, route parameters, query strings, and headers;
- workspace-relative paths and archive entries;
- plugin package manifests and bundled assets;
- MCP server, app, connector, browser, and model-provider responses;
- generated HTML, Markdown, documents, presentations, and media metadata;
- environment variables and local configuration files.

Validation should prefer explicit schemas, allowlists, normalized paths, and
root-containment checks. Invalid input should be rejected instead of silently
rewritten when the rewrite could hide an unsafe request.

## Credentials And Secrets

Credentials, dynamic tokens, and private keys must not be committed. Runtime
credentials should live in environment variables, OS/keychain-backed stores,
managed secret stores, or separate private runtime files. Logs, diagnostics,
exports, and generated artifacts should avoid bearer tokens, API keys, OAuth
client secrets, signing keys, and private keys.

Users and operators must be able to rotate credentials without recompiling the
software.

## Cryptography And Transport

Production network communication should use HTTPS/TLS, SSHv2 or later, or
another secure protocol appropriate for the transport. TLS certificate
verification must remain enabled by default before sending private headers or
cookies. Local development HTTP endpoints should remain local-only unless a
developer explicitly exposes them.

Default security mechanisms must avoid algorithms and modes with known serious
weaknesses. When iPolloWork relies on platform cryptography, provider SDKs, or
managed services, it should use their supported modern defaults.

## Hardening

The project uses several hardening layers:

- TypeScript type checks and package tests in CI;
- REUSE lint for license metadata;
- OpenSSF Scorecard for repository security posture;
- CodeQL static analysis for JavaScript and TypeScript;
- GitHub dependency review and Dependabot for vulnerable dependencies;
- Electron macOS hardened runtime and notarization for official macOS release
  artifacts when release signing credentials are configured;
- path normalization and containment checks for workspace filesystem access.

## Assurance Case

The security requirements are met through a combination of design boundaries,
automated checks, and release controls:

- user-controlled local workspaces reduce unnecessary hosted data exposure;
- explicit permission and approval flows limit high-impact actions;
- typed request/response contracts and schema validation reduce malformed input
  handling bugs;
- filesystem paths are normalized and checked before sensitive server
  operations;
- credentials are handled as runtime secrets rather than source files;
- CI runs tests, type checks, license checks, repository security checks, static
  analysis, and dependency review;
- official release workflows separate local unsigned development packages from
  public release artifacts and document signing status.

Residual risk remains for user-approved native commands, third-party plugins,
browser automation against external sites, connected model providers, and
self-hosted deployments with weak operator controls. Those risks should be made
visible in UI, documentation, issue triage, and release notes.

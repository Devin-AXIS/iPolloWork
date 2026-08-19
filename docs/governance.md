# iPolloWork Governance

iPolloWork is maintained in the `Devin-AXIS/iPolloWork` GitHub repository. The
current public project owner is the Devin-AXIS GitHub organization. Repository
role assignment is controlled through GitHub organization and repository access
settings.

## Roles

Project owner:

- owns the project direction, public repository settings, release authority,
  security contact routing, and final decisions when consensus does not emerge;
- delegates repository access and release permissions to maintainers who need
  them.

Maintainers:

- review and merge pull requests;
- triage issues and discussions;
- keep documentation aligned with current behavior;
- preserve the iPolloWork/OpenCode boundary;
- maintain CI, packaging, release, and dependency-monitoring workflows.

Security responders:

- receive private vulnerability reports;
- triage severity and affected versions;
- coordinate fixes, disclosure, reporter credit, and advisories;
- rotate credentials or signing material when required.

Release managers:

- verify release readiness;
- run the release workflow;
- confirm version, tag, artifact, signature, notarization, and release-note
  status before a release becomes public;
- coordinate rollback or hotfix releases.

Reviewers:

- provide technical review for pull requests;
- check tests, security impact, user-facing behavior, documentation, and
  license/attribution changes before merge.

Contributors:

- open issues, propose changes, and submit pull requests under
  `CONTRIBUTING.md`;
- include tests for major functionality and practical regression coverage for
  bug fixes.

## Decisions

Most decisions are made in GitHub issues and pull requests. Maintainers seek
rough consensus, but the project owner may make the final call when a decision
blocks releases, security response, repository maintenance, or product
direction.

Security-sensitive decisions may be made privately until disclosure is safe.
After disclosure, maintainers should summarize the outcome in a public release
note, advisory, issue, or pull request when doing so does not expose users to
additional risk.

## Continuity

The project should be able to continue if any one maintainer becomes
unavailable. To support that goal:

- at least two trusted people should have the practical ability to triage
  issues, merge pull requests, and publish emergency fixes;
- release signing credentials, deployment credentials, and recovery material
  should be stored in controlled organization secret stores or emergency access
  vaults, not only on one person's computer;
- production signing keys and tokens should be scoped to the minimum required
  access and rotated after suspected exposure;
- maintainers should document release and recovery steps in the repository.

## Issue Triage

Public work is tracked in GitHub Issues. Maintainers route issues by impact,
reproducibility, security sensitivity, affected platform, and whether the issue
blocks a release. Security vulnerabilities must move to the private process in
`SECURITY.md` instead of public issue discussion.

Recommended public labels include:

- `bug` for reproducible defects;
- `feature` for product requests;
- `documentation` for docs defects;
- `security` for public hardening work that is not a private vulnerability;
- `good first issue` for small, well-scoped tasks suitable for new
  contributors;
- `help wanted` for tasks where maintainers welcome outside implementation.

## Role Changes

Maintainer, security responder, and release manager access should be granted
only when the person needs the role and understands the repository's security,
licensing, and release responsibilities. Remove access when the role is no
longer needed.

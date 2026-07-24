# Windows Protocol Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two safe Windows scripts that switch `ipollowork://` between the repository development app and an installed production app.

**Architecture:** Each root `.cmd` delegates quoting, discovery, registry writes, and verification to embedded PowerShell. A test-only registry-root override permits behavior tests without changing the user's live protocol handler.

**Tech Stack:** Windows cmd, Windows PowerShell 5.1, `reg.exe`, Node.js built-in test runner.

## Global Constraints

- Modify only the current user's registry hive.
- Require no administrator privileges.
- Do not start or stop applications.
- Do not change application authentication code.
- Use pnpm for repository commands.

---

### Task 1: Protocol switching scripts

**Files:**
- Create: `切到开发版.cmd`
- Create: `恢复正式版.cmd`
- Create: `scripts/windows-protocol-switcher.test.mjs`

**Interfaces:**
- Consumes: repository-relative Electron executable and `apps/desktop/electron/main.mjs`; Windows uninstall registry and standard installation directories.
- Produces: verified `shell\open\command` for the selected `ipollowork://` handler.

- [ ] **Step 1: Write failing behavior tests**

Create tests that copy both scripts to a temporary repository-shaped directory and use `IPOLLOWORK_PROTOCOL_REGISTRY_ROOT` plus `IPOLLOWORK_PRODUCTION_EXE` overrides. Assert that the scripts are missing initially, then assert exact development registration, exact production restoration, and no registry mutation when production is missing.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test scripts/windows-protocol-switcher.test.mjs`

Expected: FAIL because the two root scripts do not exist.

- [ ] **Step 3: Implement the minimal scripts**

Use embedded PowerShell to validate paths, write URL Protocol metadata and the quoted open command, then read it back and compare exactly. Production discovery must complete before any registry write.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test scripts/windows-protocol-switcher.test.mjs`

Expected: all protocol-switching tests pass.

- [ ] **Step 5: Run focused repository checks**

Run: `git diff --check` and inspect `git status --short`.

Expected: no whitespace errors and only the two scripts, test, spec, and plan are changed.

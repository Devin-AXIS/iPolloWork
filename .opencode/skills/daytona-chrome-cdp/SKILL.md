---
name: daytona-chrome-cdp
description: Launch and control standalone Chrome in a Daytona sandbox via CDP. Use for web sign-in, OAuth, Den Web setup, browser-only flows, or when the app should not be driven through Electron CDP.
---

# Daytona Standalone Chrome CDP

Use this skill when a Daytona sandbox needs a normal Chrome/Chromium browser in
the XFCE display, separate from the Electron app. This is useful for Den Web
sign-in, OAuth provider setup, browser-only admin flows, and checking what a user
would see in a regular browser.

## Launch Chrome

Run inside the Electron or server sandbox:

```bash
daytona exec "$SANDBOX" -- "bash -lc 'mkdir -p /tmp/daytona-chrome-profile; DISPLAY=:99 nohup chromium --no-sandbox --disable-dev-shm-usage --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --user-data-dir=/tmp/daytona-chrome-profile \"$DEN_WEB_URL\" >/tmp/daytona-chrome.log 2>&1 &'"
```

If `chromium` is missing, try `google-chrome`, `google-chrome-stable`, or install
Chromium in the sandbox only when needed.

## Get The CDP URL

```bash
CHROME_CDP_URL=$(daytona preview-url "$SANDBOX" -p 9222 2>/dev/null | grep -v '^time=')
```

Verify the target directly:

```bash
curl -fsS "$CHROME_CDP_URL/json/list"
```

## Verify It Is Not Electron

The coded flow must assert that `navigator.userAgent` contains `Chrome/` or
`Chromium/` and does not contain `Electron/`.

## Drive A Web Flow

Create or reuse an `evals/flows/*.flow.mjs` flow and set its `cdpTarget` to a
stable title or URL fragment for the standalone page. Drive the visible flow
with `ctx.clickText`, `ctx.fill`, `ctx.waitFor`, and `ctx.screenshot`, then run:

```bash
pnpm evals --flow <flow-id> --cdp-url "$CHROME_CDP_URL"
```

Validate with the `fraimz` loop. Do not assume navigation or sign-in worked
until the post-action URL, visible assertion, and frame prove it.

## Common Uses

- Sign into Den Web while Electron remains on the desktop handoff screen.
- Complete OAuth approval pages from a mock or real provider.
- Configure web-only admin state before validating Electron sync.
- Compare Den Web behavior against Electron cloud account behavior.

## Stop Chrome

```bash
daytona exec "$SANDBOX" -- "bash -lc 'pkill -f \"chromium.*remote-debugging-port=9222\" || pkill -f \"chrome.*remote-debugging-port=9222\" || true'"
```

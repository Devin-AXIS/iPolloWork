# Windows protocol switching

The packaged iPolloWork app owns the `ipollowork://` protocol used to return a
browser sign-in grant to the desktop. Electron development builds intentionally
do not register that production protocol automatically. As a result, Windows
development against iPolloCloud may remain on `Connecting to iPolloWork...`
after Cloud has created the handoff grant.

This repository includes two Windows helpers for local development:

- `切到开发版.cmd` points `ipollowork://` at this source checkout.
- `恢复正式版.cmd` points it back at an installed production app.

They modify only the current user's
`HKCU\Software\Classes\ipollowork` registry key and do not require
administrator permission.

## Switch to the development app

Install dependencies and start the isolated Cloud development profile:

```powershell
.\ipollowork.cmd setup
.\ipollowork.cmd dev:cloud http://localhost:3100
```

Then double-click `切到开发版.cmd`, or run:

```powershell
.\切到开发版.cmd
```

After registration or sign-in in the system browser, approve the browser prompt
to open iPolloWork. The helper recreates the `dev:cloud` environment and
forwards the one-time callback URL to the already-running isolated Electron
profile.

The registered command follows the location of this checkout. Run the switch
script again after moving or renaming the repository.

## Restore the production app

When development testing is complete, double-click `恢复正式版.cmd`, or run:

```powershell
.\恢复正式版.cmd
```

The helper searches standard per-user and Program Files locations plus Windows
uninstall metadata. It validates the production executable before changing the
registry. If no installed production app is found, it exits with an error and
leaves the current protocol handler unchanged.

Installing or launching a packaged iPolloWork release may also register the
production handler again.

## Safety and limitations

- Only one application can own `ipollowork://` for the current Windows user.
- Switching to development temporarily redirects production browser callbacks
  to the development checkout.
- Restore the production handler before testing the packaged application.
- The scripts do not start iPolloCloud and do not initialize its database.
- This is a local workaround for external-browser development authentication;
  a dedicated development protocol remains the preferred long-term solution.

## Verification

The regression test uses a temporary registry key and never changes the live
protocol handler:

```powershell
node --test scripts/windows-protocol-switcher.test.mjs
```

It covers development registration, production restoration, and the safe
failure path when no production installation exists.

# iPollo Onto

Native DSH bundle migrated from `ipollo-onto` 0.1.7. Install its .tgz through iPolloWork Market or the native DSH Plugin Manager. Choose a registered workspace before opening the workbench. Credentials use the native Host credential store; existing local business data is retained. Disable/uninstall releases tools, Skills, routes and child services while retaining data.

Build with `npm run build`; run `npm run check` and `npm run pack:check` before packaging. See the repository migration inventory for capability-specific verification and limitations.

Onto uses SQLite for desktop project storage and accepts PostgreSQL for dedicated project databases. Existing HighGo projects remain listed with a migration notice. Back up those databases and migrate their project data to PostgreSQL before resuming access.

# Main assistant messaging entry

New IM Sessions now use `ipollo-coordinator` instead of a per-bot specialist preset or the Host default. QR authorization and automatic connection both use this entry point. The main assistant selects saved specialists or creates temporary workers through native DSH delegation; specialists no longer need individual messaging connections.

Existing Sessions keep their recorded preset and history. Send `/new` in an existing chat to use the main assistant. Per-bot model and workspace settings remain effective. Stored earlier preset choices are retained, but the suite's IM UI no longer offers them as direct entry points. Manage those specialists in the Agents page.

Disabling the suite removes the coordinator and IM components. Its Sessions require a version of the suite that provides that preset to resume; older builds do not provide a fallback composition. No DSH Session format, native storage schema, credential or channel-state migration is introduced.

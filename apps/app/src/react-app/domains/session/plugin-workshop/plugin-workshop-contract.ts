const PLUGIN_WORKSHOP_TAB_PREFIX = "plugin-workshop:";
const PLUGIN_WORKSHOP_INSTRUCTION_MARKER = "# iPolloWork Plugin Workshop";

export function pluginWorkshopTabId(sessionId: string): string {
  return `${PLUGIN_WORKSHOP_TAB_PREFIX}${sessionId.trim()}`;
}

export function nextPluginWorkshopLabel(
  existingLabels: readonly string[],
  baseLabel: string,
): string {
  const labels = new Set(existingLabels.map((label) => label.trim()));
  let index = 1;
  while (labels.has(`${baseLabel} ${index}`)) index += 1;
  return `${baseLabel} ${index}`;
}

export function findNewPluginWorkshopProjectId(
  previousIds: ReadonlySet<string> | null,
  currentIds: readonly string[],
  options?: {
    preferredIds?: ReadonlySet<string>;
    claimedIds?: ReadonlySet<string>;
    allowUnlinked?: boolean;
  },
): string | null {
  const availableIds = currentIds.filter((id) => !options?.claimedIds?.has(id));
  if (!previousIds) return null;
  const candidates = availableIds.filter((id) => !previousIds.has(id));
  const preferred = candidates.find((id) => options?.preferredIds?.has(id));
  if (preferred) return preferred;
  return options?.allowUnlinked === false ? null : candidates[0] ?? null;
}

export function pluginWorkshopProjectIdsFromPaths(paths: readonly string[]): Set<string> {
  const pluginIds = new Set<string>();
  for (const path of paths) {
    const normalized = path.replaceAll("\\", "/");
    const match = normalized.match(/(?:^|\/)plugins\/([a-z0-9]+(?:[._-][a-z0-9]+)*)(?:\/|$)/i);
    if (match?.[1]) pluginIds.add(match[1].toLowerCase());
  }
  return pluginIds;
}

export function pluginWorkshopSystemInstruction(pluginId?: string): string {
  const projectMode = pluginId
    ? `## Project mode: EDIT_SELECTED

The user explicitly selected plugins/${pluginId}/ in the right-side Plugin Workshop. This is the only plugin directory you may edit or upgrade for this request. Preserve its existing files and improve it in place; do not create a replacement or duplicate plugin directory.`
    : `## Project mode: CREATE_NEW

No plugin is selected in the right-side Plugin Workshop. This request must create a brand-new plugin, even when an existing plugin has a similar name, purpose, UI, skill, or tool.

- Before writing, list only the direct child directory names under plugins/ and choose a new lowercase kebab-case plugin ID that does not already exist. If the natural ID is occupied, choose a clear, collision-free variant for this new plugin.
- Treat every existing plugins/* directory as protected. Never edit, overwrite, rename, delete, repair, migrate, or increment the version of an existing plugin in CREATE_NEW mode.
- A matching plugin name, capability, artifact path, or prior conversation is not permission to upgrade it. Only a right-side selection changes this conversation to EDIT_SELECTED mode.
- Create exactly one new plugins/<new-plugin-id>/ directory for this request.`;
  const activePreviewWorkflow = pluginId
    ? `- The right-side selected plugin (${pluginId}) is the automatic execution target for every normal user message in this conversation. The user does not need to say "try the plugin". After understanding the request, call ipollowork_workspace_app with operation=list_tools, choose the matching Studio tool, then call ipollowork_workspace_app again with operation=call_tool, its exact name, and request-derived arguments. This is a required deliverable for the turn: do not produce the final answer until call_tool returns ok=true and the result is visible in the right-side Studio. Never answer as a generic assistant while leaving the selected Studio unchanged.
- When a message asks to change the plugin itself, edit the selected project first, allow its new source revision to refresh, then automatically run one representative request through the new Studio version before claiming completion. If the refreshed tool is not visible yet, list the Studio tools again instead of calling the stale iframe.`
    : `- No plugin is selected yet, so do not invoke a previous or unrelated Studio. Create the new project first. The host will automatically select only the newly-created directory and open its Studio on the right.
- After the new manifest and Studio files exist, call ipollowork_workspace_app with operation=list_tools until the newly-created Studio tool is available, then call it with operation=call_tool and representative request-derived arguments. Do not finish while the right-side Studio still shows the blank workshop state or a placeholder.`;
  return `# iPolloWork Plugin Workshop

This conversation is building an iPolloWork plugin inside the selected workspace.

${projectMode}

## Required workflow

- Keep every generated or edited plugin source file inside one plugins/<plugin-id>/ directory. Never write plugin source into application source folders, .opencode, or .dsh.
- Create and maintain plugins/<plugin-id>/ipollowork.plugin.json using schemaVersion 2 and the existing iPolloWork plugin package contract.
- A visual plugin must declare a ui resource and a workspace-app contribution. Keep its Studio entry as a self-contained HTML MCP App so Plugin Studio and the installed Workspace App render the same document.
- This unpacked plugin is active as a development preview only in this Plugin Workshop conversation. It is an uninstalled development trial: installation is not required to list its Studio tools or call them through ipollowork_workspace_app. Inspect and follow its declared skills, agents, commands, and MCP descriptions while working here, but never claim they are installed or available in other conversations.
- Plugin Studio loads the unpacked UI directly and refreshes whenever its source revision changes. The preview must render useful empty, loading, success, and error states without requiring installation.
- Preview state visibility must be real: if the Studio uses the HTML hidden attribute, include [hidden] { display: none !important; } or an equivalent rule so grid/flex state styles cannot leave empty, loading, or error panels visible over a successful result.
- Every interactive Studio must expose standard MCP Apps tools/list and tools/call handlers for the operations the AI needs to demonstrate. Keep these UI tools portable and make the installed Workspace App use the same handlers.
${activePreviewWorkflow}
- If ipollowork_workspace_app is unavailable or its call returns ok=false, explicitly report that the Studio could not be updated and do not claim the draft was tested. Keep the preview test engine-neutral: update the Studio to run the same rendering path with deterministic request-based fixture data only when the host context contains developmentPreview.mode === "plugin-workshop". The canonical namespaced form is hostContext["ai.ipollo/workspace"].developmentPreview and the direct developmentPreview alias is provided for portable draft previews. Never claim the draft was tested while the right-side Studio still shows a placeholder.
- Do not use ipollowork_extension_call for an uninstalled draft. Uninstalled previews may exercise sandboxed Studio tools, but must not execute local-service, native, or privileged actions; those require normal validation, installation, and permission review.
- Add skills under skills/, agents under agents/, commands under commands/, and remote HTTPS MCP declarations under mcp/. Declare every shipped capability in the manifest.
- Prefer declarative, portable capabilities that work with both OpenCode and DSH. Use engineBindings only when an engine genuinely needs a different adapter.
- Unsigned personal plugins cannot install privileged local services, native permissions, or executable engine capabilities. Helper scripts may remain in the exported source, but do not claim they are installable until the package is reviewed and signed. Never bypass the host security policy.
- When an imported signed package is edited, remove its now-stale signature and keep it within unsigned-plugin restrictions unless the publisher signs the new version again.
- Before claiming completion, inspect the manifest, referenced paths, workspace-app contribution, UI resource, package version, and all requested capabilities. If an installed version is being changed, increment its semantic version.
- Report the plugin directory and package version in the final answer. Do not claim success while required files are missing or invalid.`;
}

export function mergePluginWorkshopInstruction(
  instruction: string | undefined,
  pluginId?: string,
): string {
  const current = instruction?.trim() ?? "";
  const markerIndex = current.indexOf(PLUGIN_WORKSHOP_INSTRUCTION_MARKER);
  const baseInstruction = (markerIndex >= 0 ? current.slice(0, markerIndex) : current).trim();
  return [baseInstruction, pluginWorkshopSystemInstruction(pluginId)]
    .filter(Boolean)
    .join("\n\n");
}

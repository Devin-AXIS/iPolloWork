import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sameWorkspacePath } from './default-workspace.mjs';
import { validateAgentPresetId } from './agent-preset.mjs';

/** Register a preset's group without changing any bot workspace or existing session binding. */
export async function ensurePresetWorkspace(harness, workspace, preset, catalog, options = {}) {
  const id = validateAgentPresetId(preset);
  if (
    !id ||
    typeof harness?.isUngroupedWorkspace !== 'function' ||
    !(await harness.isUngroupedWorkspace(workspace))
  )
    return workspace;
  const directory = join(workspace, 'presets', id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const listing = await harness.rpc('workspace.list', {}, 30000, options);
  if (!Array.isArray(listing?.items)) throw new Error('Harness returned an invalid workspace list');
  let existing;
  for (const item of listing.items) {
    if (await sameWorkspacePath(item.path, directory)) {
      existing = item;
      break;
    }
  }
  // A user may rename an automatically created group. Preserve that title.
  if (existing && existing.title !== id) return directory;
  const result = existing
    ? { workspace: existing }
    : await harness.rpc('workspace.create', { path: directory }, 30000, options);
  if (!result?.workspace?.workspaceId) throw new Error('Harness returned an invalid workspace');
  if (result.created === false && result.workspace.title !== id) return directory;
  const label = catalog?.items.find((item) => item.id === id)?.label ?? id;
  const title = listing.items.some(
    (item) => item.title === label && item.workspaceId !== result.workspace.workspaceId,
  )
    ? `${label}（${id}）`
    : label;
  if (result.workspace.title !== title) {
    await harness.rpc(
      'workspace.rename',
      { workspaceId: result.workspace.workspaceId, title },
      30000,
      options,
    );
  }
  return directory;
}

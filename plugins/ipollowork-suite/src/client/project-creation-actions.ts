import { HarnessError } from '@deepseek-ai/dsh-error'
import { enterpriseError, type EnterpriseLabels } from './enterprise-locale.ts'

/** Register a native project and its selected ownership before opening a conversation. */
export interface CreatedProject { workspaceId: string; path: string; title: string }
export interface ProjectCreationActions {
  create(path: string): Promise<CreatedProject>
  assign(workspaceId: string, enterpriseId: string | null): Promise<void>
}
/** Failures owned by the project creation form; native failures retain their original cause. */
export class ProjectCreationError extends HarnessError {
  constructor(code: 'IPW_PROJECT_PATH_REQUIRED' | 'IPW_PROJECT_OWNERSHIP_PENDING', options?: ErrorOptions) {
    super(code, code, options)
  }
}
/** Accept fully qualified POSIX, Windows drive, or UNC paths; the Host validates the actual directory. */
export function isAbsoluteProjectPath(path: string): boolean {
  return !path.includes('\0') && /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(path.trim())
}
/** Localize the native structured failure without exposing filesystem or transport diagnostics. */
export function projectCreationError(error: unknown, t: EnterpriseLabels): string {
  let code: unknown
  if (typeof error === 'object' && error !== null) {
    if ('code' in error) code = error.code
    if ('rpcError' in error && typeof error.rpcError === 'object' && error.rpcError !== null && 'code' in error.rpcError) code = error.rpcError.code
  }
  switch (code) {
    case 'IPW_PROJECT_PATH_REQUIRED': return t.folderPathRequired
    case 'IPW_PROJECT_OWNERSHIP_PENDING': return t.ownershipPending
    case 'workspace/invalid-path': return t.invalidDirectory
    case 'directory-picker/unreadable': return t.unreadableDirectory
    case 'directory-picker/exists': return t.folderExists
    case 'directory-picker/create-failed': return t.folderCreateFailed
    case 'directory-picker/unavailable': return t.directoryUnavailable
    default: return enterpriseError(typeof code === 'string' ? code : error instanceof Error ? error.message : '', t)
  }
}
/** A failed ownership write retains the native project for an idempotent retry. */
export async function createOwnedProject(path: string, enterpriseId: string | null, actions: ProjectCreationActions): Promise<CreatedProject> {
  if (!isAbsoluteProjectPath(path)) throw new ProjectCreationError('IPW_PROJECT_PATH_REQUIRED')
  const project = await actions.create(path)
  try { await actions.assign(project.workspaceId, enterpriseId) }
  catch (cause) { throw new ProjectCreationError('IPW_PROJECT_OWNERSHIP_PENDING', { cause }) }
  return project
}

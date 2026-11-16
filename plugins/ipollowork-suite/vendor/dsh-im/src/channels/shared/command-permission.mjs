import { isBatchInputCommand } from './batch-input.mjs';
import { isCompactCommand } from './compact-command.mjs';
import { isClearCommand } from './clear-command.mjs';
import { isControlCommand } from './control-command.mjs';
import { isHistoryCommand } from './history-command.mjs';
import { isModelCommand } from './model-command.mjs';
import { isPresetCommand } from './preset-command.mjs';
import { isPlanCommand, isGoalCommand } from './plan-goal-command.mjs';
import { isResetCommand } from './reset-command.mjs';
import { isWorkspaceCommand } from './workspace-command.mjs';

const SIMPLE_TEXT_COMMANDS = new Set(['/help', '/status', '/new']);

/**
 * Match only commands that the shared bridges already execute locally.
 * Unknown slash-prefixed text remains an ordinary prompt.
 */
export function isSharedLocalCommand(text, {
  hasImages = false,
  hasFiles = false,
} = {}) {
  if (typeof text !== 'string') return false;
  const command = text.trim();
  if (!command) return false;
  if (isBatchInputCommand(command) || isHistoryCommand(command)) return true;
  if (isClearCommand(command) || isResetCommand(command)) return true;
  if (!hasFiles && (
    isControlCommand(command)
    || isModelCommand(command)
    || isPresetCommand(command)
  )) return true;
  if (hasImages || hasFiles) return false;
  return SIMPLE_TEXT_COMMANDS.has(command.toLowerCase())
    || isWorkspaceCommand(command)
    || isCompactCommand(command)
    || isPlanCommand(command)
    || isGoalCommand(command);
}

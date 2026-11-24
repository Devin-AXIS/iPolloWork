import {
  isAutomationCommand,
  isSolitaryAutomationCommand,
  type AutomationOperation,
} from './operations.ts';

export interface AutomationBatchCommandConflict {
  readonly message: string;
  readonly detail: string;
}

/** Stateful package-transaction admission shared by every operation in one planned batch. */
export function createBatchCommandPolicy(): {
  conflict(operation: AutomationOperation): AutomationBatchCommandConflict | null;
  note(operation: AutomationOperation): void;
  readonly hasCommands: boolean;
} {
  let hasCommands = false;
  let solitaryPlanned = false;
  let commentDeletionPlanned = false;
  let commentEditPlanned = false;
  let fieldUpdatePlanned = false;
  return {
    conflict(operation) {
      const command = isAutomationCommand(operation);
      const solitary = isSolitaryAutomationCommand(operation);
      const deletion = operation.op === 'deleteComment';
      const commentEdit = operation.op === 'setCommentText';
      const fieldUpdate = operation.op === 'updateFieldResult';
      if (
        command &&
        ((fieldUpdate && hasCommands && !fieldUpdatePlanned) ||
          (fieldUpdatePlanned && !fieldUpdate))
      ) {
        return {
          message:
            'field result updates require a batch without other edits; sync document edits before updating fields',
          detail: operation.op,
        };
      }
      if (
        command &&
        ((commentEdit && hasCommands && !commentEditPlanned) ||
          (commentEditPlanned && !commentEdit))
      ) {
        return {
          message: 'comment content edits may share a batch only with other comment content edits',
          detail: operation.op,
        };
      }
      if ((solitary && hasCommands) || (solitaryPlanned && command)) {
        return {
          message: 'that command commits on its own and cannot share a batch',
          detail: operation.op,
        };
      }
      if (
        (deletion && hasCommands && !commentDeletionPlanned) ||
        (commentDeletionPlanned && command && !deletion)
      ) {
        return {
          message: 'comment deletions may share a batch only with other comment deletions',
          detail: operation.op,
        };
      }
      return null;
    },
    note(operation) {
      if (!isAutomationCommand(operation)) return;
      hasCommands = true;
      if (isSolitaryAutomationCommand(operation)) solitaryPlanned = true;
      if (operation.op === 'setCommentText') commentEditPlanned = true;
      if (operation.op === 'deleteComment') commentDeletionPlanned = true;
      if (operation.op === 'updateFieldResult') fieldUpdatePlanned = true;
    },
    get hasCommands() {
      return hasCommands;
    },
  };
}

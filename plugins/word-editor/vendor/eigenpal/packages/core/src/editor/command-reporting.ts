/**
 * Results of commands that run outside `exec`, such as an image insert, reported into the
 * diagnostics of the editor they ran on. Its own module, so a command implementation can report
 * without importing the diagnostics reporter, which imports it in turn.
 */
import type { EditorCommand } from '../contracts/editor.ts';
import type { ExecResult } from '../contracts/types.ts';

type CommandReporter = (command: EditorCommand, result: ExecResult) => void;

const COMMAND_REPORTERS = new WeakMap<object, CommandReporter>();

/** Register the reporter of one editor instance. */
export function setCommandReporter(editor: object, reporter: CommandReporter): void {
  COMMAND_REPORTERS.set(editor, reporter);
}

/**
 * Report the result of a command that ran outside `exec`. A refusal becomes an `edit.rejected`
 * diagnostic, as it would from `exec`. Does nothing for an object that is not an editor.
 */
export function reportCommandResult(editor: object, command: EditorCommand, result: ExecResult) {
  COMMAND_REPORTERS.get(editor)?.(command, result);
}

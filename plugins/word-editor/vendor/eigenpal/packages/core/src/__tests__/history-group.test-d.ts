// Compile-time consumer checks: options cannot be mistaken for a toolbar value.
import type { Editor, EditorCommand, HistoryGroup } from '../contracts/editor.ts';
import { runToolbarCommand } from '../editor/toolbar-commands.ts';
import type { EditorCommandExecute } from '../editor/toolbar-values.ts';

declare const editor: Editor;
declare const command: EditorCommand;
declare const execute: EditorCommandExecute;
const historyGroup: HistoryGroup = editor.beginHistoryGroup();
editor.exec(command, { historyGroup });
runToolbarCommand(editor, 'text.bold', { historyGroup });
runToolbarCommand(editor, 'text.color', '0070C0', { historyGroup });
runToolbarCommand(editor, 'font.size', 24, { historyGroup });
execute();
execute({ historyGroup });
const eventHandler: (event: MouseEvent) => void = execute;
void eventHandler;
// @ts-expect-error a raw symbol is not an owned handle
editor.exec(command, { historyGroup: Symbol('gesture') });
// @ts-expect-error color values precede options
runToolbarCommand(editor, 'text.color', { historyGroup });
// @ts-expect-error font size is in numeric half-points
runToolbarCommand(editor, 'font.size', '24');
// @ts-expect-error command slots cannot swallow a value
runToolbarCommand(editor, 'text.bold', 'bad value');
// @ts-expect-error callers cannot forge ownership
const forged: HistoryGroup = { state: 'open', end() {} };
void forged;

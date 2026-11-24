import { reportHistoryGroup, type HistoryGroup } from '../store/store/history-group.ts';
import { undoHistoryPosition } from '../store/store/undo-history-position.ts';

interface Entry<T> {
  readonly anchor: object | null;
  readonly before: T;
  readonly after: T;
}

/** Local formatting preferences interleaved with the document's existing history authority. */
export class CaretFormatHistory<T> {
  private readonly undo: Entry<T>[] = [];
  private readonly redo: Entry<T>[] = [];
  private moving = false;
  private group: HistoryGroup | undefined;
  private readonly position;

  constructor(owner: object) {
    this.position = undoHistoryPosition(owner);
  }

  get canUndo(): boolean {
    return this.matches(this.undo.at(-1));
  }
  get canRedo(): boolean {
    return this.matches(this.redo.at(-1));
  }
  private matches(entry: Entry<T> | undefined): boolean {
    return !!entry && !!this.position && entry.anchor === this.position.current();
  }

  record(before: T, after: T, group?: HistoryGroup): void {
    if (!this.position) return;
    const top = this.undo.at(-1);
    if (group !== undefined && group === this.group && this.matches(top)) {
      this.undo[this.undo.length - 1] = { ...top!, after };
      reportHistoryGroup(group, 'extended');
      return;
    }
    this.group = group;
    this.position.split();
    this.redo.length = 0;
    this.undo.push({ anchor: this.position.current(), before, after });
    if (this.undo.length > 200) this.undo.shift();
    reportHistoryGroup(group, 'started');
  }

  endGroup(): void {
    this.group = undefined;
  }

  noteEdit(): void {
    this.endGroup();
    if (!this.moving) this.redo.length = 0;
  }

  step(direction: 'undo' | 'redo', restore: (value: T) => void, documentStep: () => void): void {
    const from = direction === 'undo' ? this.undo : this.redo;
    const to = direction === 'undo' ? this.redo : this.undo;
    this.endGroup();
    this.moving = true;
    try {
      if (this.matches(from.at(-1))) {
        const entry = from.pop()!;
        to.push(entry);
        restore(direction === 'undo' ? entry.before : entry.after);
      } else documentStep();
    } finally {
      this.moving = false;
    }
  }
}

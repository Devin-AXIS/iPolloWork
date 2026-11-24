import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { describe, expect, test } from 'bun:test';
import type { Editor, HistoryGroup } from '../../contracts/editor.ts';
import { bindHistoryGroup } from '../bind-history-group.ts';

function fixture(kind: 'range' | 'repeat' | 'native-color' | 'keyboard') {
  const handles: HistoryGroup[] = [];
  const editor = {
    beginHistoryGroup() {
      let closed = false;
      const handle = {
        get state() {
          return closed ? 'closed' : 'open';
        },
        end() {
          closed = true;
        },
      } as HistoryGroup;
      handles.push(handle);
      return handle;
    },
  } as Editor;
  const element = document.createElement('input');
  document.body.append(element);
  const binding = bindHistoryGroup(editor, element, { kind });
  return {
    element,
    binding,
    handles,
    dispose() {
      binding.dispose();
      element.remove();
    },
  };
}
const pointer = (type: string, id = 1) =>
  new PointerEvent(type, { bubbles: true, pointerId: id, button: 0 });
const key = (type: string, value: string, repeat = false) =>
  new KeyboardEvent(type, { bubbles: true, key: value, repeat });

describe('native gesture lifecycle', () => {
  test('range final input joins the frame before outside release, then a new drag starts fresh', async () => {
    const f = fixture('range');
    try {
      f.element.dispatchEvent(pointer('pointerdown'));
      const first = f.binding.options().historyGroup!;
      f.element.dispatchEvent(new Event('input', { bubbles: true }));
      document.dispatchEvent(pointer('pointerup', 2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(first.state).toBe('open');
      document.dispatchEvent(pointer('pointerup'));
      expect(f.binding.options().historyGroup).toBe(first);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(first.state).toBe('closed');
      f.element.dispatchEvent(pointer('pointerdown'));
      expect(f.binding.options().historyGroup).not.toBe(first);
    } finally {
      f.dispose();
    }
  });
  test('native change closes after framework handlers apply the final value', async () => {
    const f = fixture('native-color');
    try {
      f.element.dispatchEvent(key('keydown', 'Enter'));
      const first = f.binding.options().historyGroup!;
      f.element.dispatchEvent(key('keyup', 'Enter'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(first.state).toBe('open');
      const frames: HistoryGroup[] = [];
      const apply = () => frames.push(f.binding.options().historyGroup!);
      f.element.addEventListener('input', apply);
      f.element.addEventListener('change', apply);
      f.element.dispatchEvent(new Event('input'));
      f.element.dispatchEvent(new Event('input'));
      f.element.dispatchEvent(new Event('change'));
      expect(frames).toEqual([first, first, first]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(first.state).toBe('closed');
      f.element.dispatchEvent(key('keydown', 'Enter'));
      expect(f.binding.options().historyGroup).not.toBe(first);
    } finally {
      f.dispose();
    }
  });
  test('held keys retain one handle and a new press starts another', async () => {
    const f = fixture('repeat');
    try {
      f.element.dispatchEvent(key('keydown', 'ArrowUp'));
      const first = f.binding.options().historyGroup!;
      for (let i = 0; i < 4; i++) f.element.dispatchEvent(key('keydown', 'ArrowUp', true));
      expect(f.handles).toHaveLength(1);
      document.dispatchEvent(key('keyup', 'ArrowUp'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(first.state).toBe('closed');
      f.element.dispatchEvent(key('keydown', 'ArrowUp'));
      expect(f.handles).toHaveLength(2);
    } finally {
      f.dispose();
    }
  });
  for (const terminal of ['pointercancel', 'lostpointercapture', 'blur']) {
    test(`${terminal} ends a range gesture`, async () => {
      const f = fixture('range');
      try {
        f.element.dispatchEvent(pointer('pointerdown'));
        const first = f.binding.options().historyGroup!;
        f.element.dispatchEvent(terminal === 'blur' ? new Event('blur') : pointer(terminal));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(first.state).toBe('closed');
      } finally {
        f.dispose();
      }
    });
  }
  test('new native activation ends an unterminated stream; disposal removes listeners', async () => {
    const f = fixture('native-color');
    f.element.dispatchEvent(new Event('input'));
    const first = f.binding.options().historyGroup!;
    f.element.dispatchEvent(key('keydown', 'Enter'));
    expect(first.state).toBe('closed');
    const last = f.binding.options().historyGroup!;
    f.binding.dispose();
    expect(last.state).toBe('closed');
    f.element.dispatchEvent(new Event('input'));
    expect(f.handles).toHaveLength(2);
    expect(() => f.binding.options()).toThrow('disposed');
    f.dispose();
  });
  test('a queued terminal cannot end a newer activation', async () => {
    const f = fixture('range');
    try {
      f.element.dispatchEvent(pointer('pointerdown'));
      document.dispatchEvent(pointer('pointerup'));
      f.element.dispatchEvent(pointer('pointerdown', 2));
      const next = f.binding.options().historyGroup!;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(next.state).toBe('open');
    } finally {
      f.dispose();
    }
  });
});

test('activation precedes host target listeners registered before the binding', () => {
  const element = document.createElement('button');
  document.body.append(element);
  const groups: HistoryGroup[] = [];
  const editor = {
    beginHistoryGroup() {
      let closed = false;
      return {
        get state() {
          return closed ? 'closed' : 'open';
        },
        end() {
          closed = true;
        },
      } as HistoryGroup;
    },
  } as Editor;
  const apply = () => groups.push(binding.options().historyGroup!);
  element.addEventListener('keydown', apply);
  element.addEventListener('pointerdown', apply);
  const binding = bindHistoryGroup(editor, element, { kind: 'repeat' });
  try {
    element.dispatchEvent(key('keydown', 'ArrowUp'));
    element.dispatchEvent(key('keydown', 'ArrowUp', true));
    expect(groups[0]).toBe(groups[1]);
    element.dispatchEvent(pointer('pointerdown'));
    expect(groups[2]).toBe(binding.options().historyGroup);
    expect(groups[2]).not.toBe(groups[1]);
  } finally {
    binding.dispose();
    element.remove();
  }
});

test('stopping keyup propagation cannot merge separate presses', async () => {
  const f = fixture('keyboard');
  f.element.addEventListener('keyup', (event) => event.stopPropagation());
  try {
    f.element.dispatchEvent(key('keydown', 'ArrowUp'));
    const first = f.binding.options().historyGroup!;
    f.element.dispatchEvent(key('keyup', 'ArrowUp'));
    expect(f.binding.options().historyGroup).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.state).toBe('closed');
    f.element.dispatchEvent(key('keydown', 'ArrowUp'));
    expect(f.binding.options().historyGroup).not.toBe(first);
  } finally {
    f.dispose();
  }
});

// The composable value pop-up: the packaged calendar, the checkbox pass-through, the parts
// ladder (className / hidden / asChild / data-*) and the draft hook.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import { DocxEditorContentControlWidget } from '../src/editor/DocxEditorContentControlWidget';
import { useContentControlWidget } from '../src/editor/content-control-widget/context';

afterEach(cleanup);

function session(
  kind: ContentControlWidgetSession['kind'],
  value: string,
  items: ContentControlWidgetSession['items'] = []
) {
  const abort = new AbortController();
  const writes: string[] = [];
  const instance: ContentControlWidgetSession = {
    controlId: 'sdt:1',
    kind,
    items,
    value,
    locale: 'en-US',
    anchor: null,
    signal: abort.signal,
    canApply: () => !abort.signal.aborted,
    apply: (next) => {
      writes.push(next);
      abort.abort();
      return true;
    },
    cancel: () => abort.abort(),
  };
  return { session: instance, abort, writes };
}

describe('DocxEditorContentControlWidget', () => {
  test('a date session renders the packaged calendar on the authored month', () => {
    const { session: date, writes } = session('date', '2026-09-08T00:00:00Z');
    const view = render(<DocxEditorContentControlWidget session={date} />);
    const popup = view.container.querySelector<HTMLElement>('[data-docx-popup]')!;
    expect(popup.dataset.kind).toBe('date');
    expect(popup.querySelector('input[type=date]')).toBeNull();
    expect(popup.querySelector('[data-docx-part=month]')).not.toBeNull();
    expect(popup.querySelector('[data-docx-part=input]')).not.toBeNull();
    expect(popup.querySelector('[data-docx-part="title"]')?.textContent).toBe('September 2026');
    expect(popup.querySelectorAll('[data-docx-part="day"]')).toHaveLength(42);
    expect(popup.querySelectorAll('[role="row"]')).toHaveLength(6);
    expect(popup.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(popup.querySelectorAll('[data-docx-part="weekdays"] > span')).toHaveLength(7);
    // en-US starts the week on Sunday, so the first cell is Sunday, August 30.
    expect(popup.querySelector<HTMLElement>('[data-docx-part="day"]')?.dataset.iso).toBe(
      '2026-08-30'
    );
    const selected = popup.querySelector<HTMLElement>('[data-selected]')!;
    expect(selected.dataset.iso).toBe('2026-09-08');
    expect(document.activeElement).toBe(selected);

    fireEvent.click(popup.querySelector('[data-docx-part="nextMonth"]')!);
    expect(popup.querySelector('[data-docx-part="title"]')?.textContent).toBe('October 2026');

    fireEvent.click(popup.querySelector('[data-iso="2026-10-15"]')!);
    expect(writes).toEqual(['2026-10-15']);
    expect(view.container.querySelector('[data-docx-popup]')).toBeNull();
  });

  test('Today commits the current date and arrow keys roam across a month edge', () => {
    const { session: date, writes } = session('date', '2026-09-01');
    const view = render(<DocxEditorContentControlWidget session={date} />);
    const popup = view.container.querySelector<HTMLElement>('[data-docx-popup]')!;
    const first = popup.querySelector<HTMLElement>('[data-iso="2026-09-01"]')!;
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(popup.querySelector('[data-docx-part="title"]')?.textContent).toBe('August 2026');
    expect(document.activeElement).toBe(popup.querySelector('[data-iso="2026-08-31"]'));
    expect(popup.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);

    fireEvent.click(popup.querySelector('[data-docx-part="today"]')!);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;
    expect(writes).toEqual([iso]);
  });

  test('month navigation keeps focus and closing restores the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { session: date } = session('date', '2026-09-08');
    const view = render(<DocxEditorContentControlWidget session={date} />);
    const next = view.container.querySelector<HTMLButtonElement>('[data-docx-part="nextMonth"]')!;
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test('a checkbox session applies its toggle at once and renders nothing', async () => {
    const { session: box, writes } = session('checkbox', 'false');
    const view = render(<DocxEditorContentControlWidget session={box} />);
    await act(async () => {});
    expect(view.container.querySelector('[data-docx-popup]')).toBeNull();
    expect(writes).toEqual(['true']);
  });

  test('a host intercepts a checkbox by rendering its own children', () => {
    const { session: box, writes } = session('checkbox', 'true');
    function Confirm() {
      const widget = useContentControlWidget();
      return (
        <button
          type="button"
          onClick={() => widget.apply(widget.value === 'true' ? 'false' : 'true')}
        >
          confirm {widget.kind}
        </button>
      );
    }
    const view = render(
      <DocxEditorContentControlWidget session={box}>
        <Confirm />
      </DocxEditorContentControlWidget>
    );
    expect(writes).toEqual([]);
    fireEvent.click(view.getByText('confirm checkbox'));
    expect(writes).toEqual(['false']);
  });

  test('parts take className, data-*, hidden and asChild without losing their wiring', () => {
    const { session: list, writes } = session('dropdown', 'b', [
      { displayText: 'Alpha', value: 'a' },
      { displayText: 'Bravo', value: 'b' },
    ]);
    const view = render(
      <DocxEditorContentControlWidget session={list} className="brand">
        <DocxEditorContentControlWidget.List className="brand-list" data-testid="list" />
        <DocxEditorContentControlWidget.Error hidden />
        <DocxEditorContentControlWidget.Cancel asChild>
          <a href="#close">Close it</a>
        </DocxEditorContentControlWidget.Cancel>
      </DocxEditorContentControlWidget>
    );
    const popup = view.container.querySelector<HTMLElement>('[data-docx-popup]')!;
    expect(popup.className).toBe('docx-content-control-widget-popup brand');
    const listElement = view.getByTestId('list');
    expect(listElement.className).toBe('docx-content-control-menu-list brand-list');
    expect(listElement.getAttribute('role')).toBe('listbox');
    const options = [...listElement.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    // `asChild` renders the host's element with the part's handler and without the
    // packaged dialog classes.
    const close = view.getByText('Close it');
    expect(close.tagName).toBe('A');
    expect(close.className).toBe('');
    expect(close.getAttribute('data-docx-part')).toBe('cancel');
    fireEvent.click(options[0]!);
    expect(writes).toEqual(['a']);
  });

  test('a combo box takes free text through its input and Enter', () => {
    const { session: combo, writes } = session('comboBox', 'M', [
      { displayText: 'Small', value: 'S' },
    ]);
    const view = render(<DocxEditorContentControlWidget session={combo} />);
    const input = view.container.querySelector<HTMLInputElement>('[data-docx-part="input"]')!;
    expect(input.value).toBe('M');
    fireEvent.change(input, { target: { value: 'Extra large' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(writes).toEqual(['Extra large']);
  });
});

test('an empty gallery announces its state and takes keyboard focus', () => {
  const current = session('buildingBlockGallery', '');
  const view = render(<DocxEditorContentControlWidget session={current.session} />);
  const note = view.container.querySelector<HTMLElement>('[data-docx-part=empty]')!;
  expect(note.textContent).toContain('no building blocks');
  expect(document.activeElement).toBe(note);
});

test('picture reads are bounded and failures resolve false with retry feedback', async () => {
  const current = session('picture', 'drawing');
  let reads = 0;
  let writes = 0;
  let widget: ReturnType<typeof useContentControlWidget> | undefined;
  function Probe() {
    widget = useContentControlWidget();
    return <DocxEditorContentControlWidget.Error />;
  }
  render(
    <DocxEditorContentControlWidget
      session={{
        ...current.session,
        replaceImage: async () => {
          writes++;
          return false;
        },
      }}
    >
      <Probe />
    </DocxEditorContentControlWidget>
  );
  const oversized = {
    size: 32 * 1024 * 1024 + 1,
    arrayBuffer: async () => {
      reads++;
      return new ArrayBuffer(0);
    },
  } as unknown as Blob;
  await act(async () => {
    expect(await widget!.replaceImage(oversized)).toBe(false);
  });
  expect(reads).toBe(0);
  expect(writes).toBe(0);
  const unreadable = {
    size: 2,
    arrayBuffer: async () => {
      throw new Error('read failed');
    },
  } as unknown as Blob;
  await act(async () => {
    expect(await widget!.replaceImage(unreadable)).toBe(false);
  });
  expect(widget!.refused).toBe(true);
});

import type { ReactElement } from 'react';
import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorHyperLink as HyperLink } from '../src/editor/DocxEditorHyperLink';
import { useHyperlinkPopup } from '../src/editor/useHyperlinkPopup';
import { DocxEditorPageSetupDialog as Page } from '../src/editor/DocxEditorPageSetup';
import { createPackagedPopups } from '../src/editor/popup-config';
import type { DocxEditorPopups } from '../src/editor/popup-config';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

function OpenLink() {
  const popup = useHyperlinkPopup();
  return <button onClick={() => popup.open()}>Open link</button>;
}

for (const configured of [undefined, false, 'custom'] as const) {
  test(`Page Setup ownership: ${String(configured)} alongside legacy onPageSetup`, async () => {
    let legacy = 0;
    const popups: DocxEditorPopups = {
      pageSetup:
        configured === 'custom'
          ? (props) => <Page {...props} className="custom-page" />
          : configured,
    };
    const view = render(
      <DocxEditor document="blank" menu={{ onPageSetup: () => legacy++ }} popups={popups} />
    );
    await act(async () => {});
    await act(async () => {
      fireEvent.click(view.getByRole('menuitem', { name: 'File', exact: true }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('menuitem', { name: /Page setup/i }));
    });
    expect(legacy).toBe(configured === undefined ? 1 : 0);
    expect(view.container.querySelectorAll('dialog').length).toBe(configured === 'custom' ? 1 : 0);
    if (configured === 'custom')
      expect(view.container.querySelectorAll('dialog.custom-page').length).toBe(1);
  });
}

test('configured hyperlink mounts once under Root and retains shared trigger state', async () => {
  const view = render(
    <DocxEditorRoot
      document="blank"
      popups={{
        hyperlink: (props) => (
          <HyperLink {...props}>
            <HyperLink.Apply asChild>
              <button>Save custom link</button>
            </HyperLink.Apply>
          </HyperLink>
        ),
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <OpenLink />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await act(async () => {});
  await act(async () => {
    fireEvent.click(view.getByText('Open link'));
  });
  expect(view.container.querySelectorAll('[data-testid="hyperlink-popup"]').length).toBe(1);
  expect(view.getAllByText('Save custom link').length).toBe(1);
});

test('false permits one manually mounted hyperlink owner', async () => {
  const view = render(
    <DocxEditorRoot document="blank" popups={{ hyperlink: false }}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <HyperLink />
        <OpenLink />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await act(async () => {});
  await act(async () => {
    fireEvent.click(view.getByText('Open link'));
  });
  expect(view.container.querySelectorAll('[data-testid="hyperlink-popup"]').length).toBe(1);
});

test('explicit popup entries override legacy visibility and context-menu props', () => {
  const custom: NonNullable<DocxEditorPopups['contextMenu']> = (props) => (
    <span>{String(Boolean(props.t))}</span>
  );
  expect(
    createPackagedPopups({ hyperlink: false, contextMenu: custom }, true, false, undefined)
      .hyperlink
  ).toBe(false);
  const configured = createPackagedPopups(
    { contextMenu: custom },
    false,
    false,
    undefined
  ).contextMenu;
  expect(typeof configured).toBe('function');
  if (configured)
    expect(
      (configured({ t: () => 'catalog' }) as ReactElement<{ children: string }>).props.children
    ).toBe('true');
  expect(createPackagedPopups({}, false, false, undefined).contextMenu).toBe(false);
});

test('legacy context-menu translator survives an omitted popup override', () => {
  const legacy = () => 'legacy';
  const configured = createPackagedPopups({}, true, { t: legacy }, () => 'editor').contextMenu;
  if (!configured) throw new Error('Expected default renderer');
  const output = configured({ t: () => 'catalog' }) as ReactElement<{ t: (key: string) => string }>;
  expect(output.props.t('menu.copy')).toBe('legacy');
});

test('explicit context-menu renderer receives editor translation without legacy options', () => {
  let received: unknown;
  const configured = createPackagedPopups(
    {
      contextMenu: (props) => {
        received = props;
        return <span>{props.t?.('menu.copy')}</span>;
      },
    },
    true,
    { t: () => 'legacy', className: 'legacy-menu' },
    () => 'editor'
  ).contextMenu;
  if (!configured) throw new Error('Expected custom renderer');
  const output = configured({ t: () => 'catalog' }) as ReactElement<{ children: string }>;
  expect(output.props.children).toBe('editor');
  expect(received).not.toHaveProperty('className');
});

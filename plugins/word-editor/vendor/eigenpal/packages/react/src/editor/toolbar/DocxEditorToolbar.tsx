import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The compound toolbar root: the FULL chrome registry as the default, with in-place
// overrides.
//
// DEFAULT-SET + IN-PLACE OVERRIDE SEMANTICS. With no children the toolbar renders the
// COMPLETE chrome — every group and control of `CHROME_GROUPS`, in registry
// order, with a separator between groups. The arrangement is DERIVED from the registry
// rather than hand-listed, so a registry change flows through: a new control renders
// as a live `ToolbarButton` (disabled with the engine's reason until it is wired)
// without touching this file. Controls whose SHAPE the registry declares specially
// render through their dedicated parts: the FontFamily compound, the font-size and
// zoom steppers (wired), the colour split buttons (wired), the pickers this toolbar
// does not drive yet (disabled lookalikes), and save (live only with an `onSave`
// handler).
//
// WITH children, each child that is a toolbar PART — detected by the static slot
// marker (`Component.docxSlot`, or `ToolbarButton`'s marker plus its `slot` prop;
// never displayName, which minifies away) — REPLACES its slot in the default
// arrangement in place, so `<Toolbar><Bold className="fat"/></Toolbar>` is still the
// whole toolbar with one customized button. A part child with `hidden` removes its
// slot (the part renders null where it stands), and a group whose slots are all hidden is
// dropped with its separator. `Toolbar.Group` children describe groups: a built-in id adds
// controls to that group or hides it, any other id is a host group that is measured and
// collapses like the built-in ones. Other children append after the default set and never
// collapse. `preset={false}` opts out entirely: children render verbatim.
//
// ONE ROW, MEASURED. The bar used to wrap to a second and third row when it ran out of
// width, which on a laptop beside an open navigation pane cost more vertical space than the
// first page of the document. Now it measures itself and moves controls into a "⋯" menu,
// one at a time from the end of the group the collapse order names, so the bar stays full
// (`useToolbarOverflow` for the measurement, core's `toolbar-item-fit.ts` for the policy).
// That is why the default arrangement below is a list of groups rather than a flat list of
// slots: the group decides what collapses next, and its registry label becomes the panel's
// section heading. `overflow={false}` restores wrapping.

import { ToolbarEditingMode } from './EditingMode';
import { ToolbarReviewers } from './Reviewers';
import { Children, Fragment, isValidElement, useMemo } from 'react';
import type { ReactElement } from 'react';
import { unwrapFragment } from '../merge-arrangement';
import {
  chartPaneAvailable,
  shapePaneAvailable,
  chromeSlotId,
  formattingBarChromeGroups,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useEditorState } from '../useEditorState';
import { useChromeDir } from '../../i18n';
import { ToolbarContext, useToolbarLabelFor, type ToolbarTranslate } from './toolbar-context';
import { ToolbarButton, chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import { ParagraphDialogHost } from '../paragraph-dialog-host';
import {
  ToolbarOverflow,
  ToolbarOverflowControl,
  ToolbarOverflowItem,
  type ToolbarOverflowSection,
} from './ToolbarOverflow';
import {
  arrangeToolbarGroups,
  collapseOrder,
  TOOLBAR_COLLAPSE_ORDER,
  orderToolbarOverflowSections,
  TOOLBAR_PINNED_GROUPS,
  toolbarGroupItems,
  toolbarHostPanelShown,
  toolbarShownCount,
  type ToolbarFitGroup,
} from '@docx-editor.dev/core/editor';
import { readToolbarChildren, type ToolbarChildren } from './toolbar-children';
import {
  hostGroupText,
  ToolbarHostGroup,
  type DocxEditorToolbarGroupProps,
  ToolbarPlacementContext,
  ToolbarSlot,
} from './ToolbarGroup';
import { ToolbarAddComment } from './AddComment';
import {
  warnBuiltInGroupSetting,
  warnReservedGroupId,
  warnSlotOutsideArrangement,
  warnUnknownGroupAnchor,
} from './toolbar-warnings';
import {
  FIXED_ATTRIBUTE,
  GROUP_ATTRIBUTE,
  ITEM_ATTRIBUTE,
  useToolbarOverflow,
} from './useToolbarOverflow';
import {
  type ImageAltTextPartComponent,
  type ImageWrapPartComponent,
  ToolbarImageInsert,
  ToolbarImageProperties,
  ToolbarImageWrap,
  ToolbarImageAltText,
} from '../images';
import { ToolbarChartInsert, type ChartInsertPartComponent } from '../charts/ChartInsert';
import {
  ToolbarAlignCenter,
  ToolbarAlignJustify,
  ToolbarAlignLeft,
  ToolbarAlignRight,
  ToolbarBold,
  ToolbarBulletList,
  ToolbarClearFormatting,
  ToolbarComments,
  ToolbarIndent,
  ToolbarItalic,
  ToolbarLeftToRight,
  ToolbarLink,
  ToolbarNumberedList,
  ToolbarOutdent,
  ToolbarRedo,
  ToolbarRightToLeft,
  ToolbarSave,
  ToolbarSeparator,
  ToolbarStrike,
  ToolbarSubscript,
  ToolbarSuperscript,
  ToolbarTableInsert,
  ToolbarUnderline,
  ToolbarUndo,
  type ToolbarPartComponent,
  type ToolbarSlotPartComponent,
} from './parts';
import { ToolbarFontSize, ToolbarZoom } from './steppers';
import { ToolbarLineSpacing } from './LineSpacing';
import { ToolbarFontColor, ToolbarHighlight, type ToolbarColorSplitComponent } from './ColorSplit';
import { ToolbarAlignment, type ToolbarAlignmentComponent } from './Alignment';
import { ToolbarAction } from './ToolbarAction';
import { FontFamily, useFontFamily } from './FontFamily';
import { ParagraphStyle, useParagraphStyle } from './ParagraphStyle';
import {
  CONTENT_CONTROL_SHAPED_PARTS,
  ToolbarContentControlFormFill,
  ToolbarContentControlInspector,
  ToolbarContentControlRemove,
  ToolbarContentControlShowAll,
} from './ContentControlParts';
import {
  TableChromeGroup,
  ToolbarTableBorderColor,
  ToolbarTableBorderStyle,
  ToolbarTableBorderTarget,
  ToolbarTableBorderWidth,
  ToolbarTableCellFill,
  type TableBorderColorNamespace,
  type TableBorderStyleNamespace,
  type TableBorderTargetNamespace,
  type TableBorderWidthNamespace,
  type TableCellFillNamespace,
} from './TableControls';
import { TableChromeProvider } from './useTableChrome';
import { OBJECT_TOOLBAR_PARTS } from '../objects/toolbar-parts';
import { ToolbarTableMergeCells, ToolbarTableSplitCell } from './TableCellStructure';
import { useChromeScopeClassName } from '../color-mode-context';
import { ScopedByAncestorContext } from '../scope-context';
import { ObjectControlVariantContext } from '../objects/object-controls';
import { useDocxEditor } from '../context';

/** Contextual table chrome slots appended when the caret is inside a table. */
const TABLE_CHROME_SLOTS: readonly ChromeSlotId[] = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
  'table.mergeCells',
  'table.splitCell',
];

const TABLE_CONTEXTUAL_GROUP_ID = 'contextual-table';

/**
 * A default-arrangement key: a chrome slot, or `'alignment'` for the MERGED
 * alignment dropdown that stands in for the four `alignment.*` slots.
 */
type ArrangementKey = ChromeSlotId | 'alignment';

/** One default-arrangement entry: the slot and the part that draws it. */
interface DefaultEntry {
  readonly slot: ArrangementKey;
  readonly Part: PartLike;
}

/** A registry group as the toolbar renders it: the collapse unit and a panel section. */
interface DefaultGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly entries: readonly DefaultEntry[];
}

type PartLike = (props: { hidden?: boolean }) => DocxEditorChildren;

/**
 * The parts whose slot needs more than an icon button: compounds, steppers, colour
 * splits, the undriven pickers, and save. Everything NOT named here renders as a live
 * `ToolbarButton` for its slot — which is also the fallback for any control a future
 * registry revision adds, so the arrangement below never goes stale.
 */
const SHAPED_PARTS: Partial<Record<ChromeSlotId, PartLike>> = {
  'zoom.level': ToolbarZoom,
  'styles.style': ParagraphStyle,
  'font.family': FontFamily,
  'font.size': ToolbarFontSize,
  'text.color': ToolbarFontColor,
  'text.highlight': ToolbarHighlight,
  // Insert Link is icon-SHAPED but not command-driven: a link needs a target, so the press
  // opens the popover instead of running the slot's command. Its enabled state still comes
  // from the engine, like every other control.
  'text.link': ToolbarLink,
  'list.lineSpacing': ToolbarLineSpacing,
  'review.editingMode': ToolbarEditingMode,
  'review.authors': ToolbarReviewers,
  'file.save': ToolbarSave,
  // Content-control chrome: mode toggles and inspector/remove. Keys only apply once
  // `CHROME_GROUPS` registers the `contentControl` group; until then the default bar
  // does not list them (no hand-listed slots), and hosts compose the named parts.
  ...CONTENT_CONTROL_SHAPED_PARTS,
  'table.borderTarget': ToolbarTableBorderTarget,
  'table.borderColor': ToolbarTableBorderColor,
  'table.borderStyle': ToolbarTableBorderStyle,
  'table.borderWidth': ToolbarTableBorderWidth,
  'table.cellFill': ToolbarTableCellFill,
  // Opens a dialog rather than running its slot, so it is drawn like a picker everywhere.
  'table.splitCell': ToolbarTableSplitCell,
  'image.insert': ToolbarImageInsert,
  'image.properties': ToolbarImageProperties,
  'image.wrap': ToolbarImageWrap,
  'insert.chart': ToolbarChartInsert,
  'image.altText': ToolbarImageAltText,
  // The contextual shape and chart groups: the object parts in their compact form.
  ...OBJECT_TOOLBAR_PARTS,
};

/** Shaped parts that render as a "⋯" panel row themselves. See `usePanelRow`. */
const PANEL_ROW_SLOTS: ReadonlySet<ArrangementKey> = new Set<ChromeSlotId>([
  'image.insert',
  'image.properties',
  'image.wrap',
  'image.altText',
]);

const TABLE_CONTEXTUAL_GROUP: DefaultGroup = {
  id: TABLE_CONTEXTUAL_GROUP_ID,
  labelKey: 'formattingBar.groups.table',
  entries: TABLE_CHROME_SLOTS.map((slot) => ({
    slot,
    // Merge is a plain command button; every other table slot has a shaped part.
    Part: slot === 'table.mergeCells' ? ToolbarTableMergeCells : SHAPED_PARTS[slot]!,
  })),
};

/** Icon-button fallback parts, one per slot, created once. */
const iconPartCache = new Map<ChromeSlotId, PartLike>();
function iconPart(slot: ChromeSlotId): PartLike {
  let part = iconPartCache.get(slot);
  if (!part) {
    part = (props: { hidden?: boolean }) => <ToolbarButton slotId={slot} {...props} />;
    iconPartCache.set(slot, part);
  }
  return part;
}

/**
 * The DEFAULT chrome, in registry order, separators between groups: every
 * non-contextual registry group — the registry's default bar, which ends at the
 * editing-mode picker (contextual slots stay available for composition) — with the
 * alignment group merged into ONE dropdown under the `'alignment'` key.
 */
function buildDefaultGroups(
  image: EditorSnapshot['image'],
  direction: boolean,
  panes: { readonly chart: boolean; readonly shape: boolean },
  chart: boolean
): readonly DefaultGroup[] {
  // Each button shows only when a mounted pane or listener takes its own pane.
  const shape = panes.shape && !!image?.shapeFormat;
  const objects = { shapeControls: !!image?.shapeFormat, chartControls: chart };
  return formattingBarChromeGroups(image, {
    direction,
    chart: panes.chart && chart,
    shape,
    ...objects,
  }).map((group) => {
    if (group.id === 'alignment') {
      return {
        id: group.id,
        labelKey: group.labelKey,
        entries: [{ slot: 'alignment' as ArrangementKey, Part: ToolbarAlignment }],
      };
    }
    return {
      id: group.id,
      labelKey: group.labelKey,
      entries: group.controls.map((control) => {
        const slot = chromeSlotId(group, control);
        return { slot: slot as ArrangementKey, Part: SHAPED_PARTS[slot] ?? iconPart(slot) };
      }),
    };
  });
}

const selectToolbarImage = (snapshot: EditorSnapshot) => snapshot.image;
const selectToolbarChart = (snapshot: EditorSnapshot) => snapshot.chart !== null;
const selectToolbarDisabled = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;
const selectTableChromeVisible = (snapshot: EditorSnapshot) => snapshot.table !== null;

/** Slots whose panel row is the CONTROL itself, because it shows a value. */
function isValueSlot(slot: ArrangementKey): boolean {
  return slot === 'alignment' || slot in SHAPED_PARTS;
}

/** The slot one child element drives, or null for a non-part child. */
function slotOfChild(child: ReactNode): ArrangementKey | null {
  const unwrapped = unwrapFragment(child, slotOfChild);
  if (unwrapped !== null) return unwrapped as ArrangementKey;
  if (!isValidElement(child)) return null;
  const type = child.type as {
    docxSlot?: unknown;
    docxToolbarPart?: unknown;
    docxToolbarSlot?: unknown;
  };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxSlot === 'string') return type.docxSlot as ArrangementKey;
  if (type.docxToolbarSlot === true) {
    const slotId = (child.props as { slotId?: unknown }).slotId;
    return typeof slotId === 'string' ? (slotId as ArrangementKey) : null;
  }
  if (type.docxToolbarPart === true) {
    const props = child.props as { slotId?: unknown; slot?: unknown };
    const slot = props.slotId ?? props.slot;
    if (typeof slot === 'string') return slot as ArrangementKey;
  }
  return null;
}
/** Props for `DocxEditor.Toolbar`. @public */
export interface DocxEditorToolbarProps {
  /** Appended after the base `docx-toolbar` class. */
  className?: string;
  /** i18n resolver for control labels; without it the raw keys show (never English). */
  t?: ToolbarTranslate;
  /**
   * Handler for the `file.save` control. Save is not an engine command (`Editor.save()`
   * returns bytes the host must deliver), so without a handler the control renders
   * disabled — same contract as the Vue toolbar's `onSave`.
   */
  onSave?: () => void;
  /**
   * `false` renders children verbatim with no default arrangement. Default `true`:
   * part children override their slots in place, others append.
   */
  preset?: boolean;
  /**
   * `false` lets the bar WRAP to more rows instead of moving controls into the "⋯" menu,
   * one at a time, when it runs out of width. Default `true`.
   */
  overflow?: boolean;
  children?: DocxEditorChildren;
}

/** Whether a node tree contains any contextual table chrome part (recursive child walk). */
function walkForTableChromeParts(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (Array.isArray(node)) return node.some(walkForTableChromeParts);
  const slot = slotOfChild(node);
  if (slot != null && (TABLE_CHROME_SLOTS as readonly string[]).includes(slot)) return true;
  if (isValidElement(node)) {
    return Children.toArray((node.props as { children?: DocxEditorChildren }).children).some(
      walkForTableChromeParts
    );
  }
  return false;
}

function includesTableChromeParts(children: ReactNode, preset: boolean): boolean {
  if (preset) return true;
  return Children.toArray(children).some(walkForTableChromeParts);
}

function DocxEditorToolbarRoot(props: DocxEditorToolbarProps) {
  // Skip the scope class when the packaged wrapper already carries it.
  const scopeClassName = useChromeScopeClassName();
  const { className, t, onSave, preset = true, overflow: overflowEnabled = true, children } = props;
  const context = useMemo(() => ({ t, onSave }), [t, onSave]);
  // The overflow panel labels its value rows from the same resolver the parts inside it
  // use. It runs above `ToolbarContext.Provider`, so it takes the host `t` directly.
  const label = useToolbarLabelFor(t);
  const image = useEditorState(selectToolbarImage);
  // Edit chart and Format shape show only when the host can show a side panel.
  const editor = useDocxEditor();
  const chart = useEditorState(selectToolbarChart);
  const chartPane = chartPaneAvailable(editor);
  const shapePane = shapePaneAvailable(editor);
  const toolbarDisabled = useEditorState(selectToolbarDisabled);
  const tableChromeVisible = useEditorState(selectTableChromeVisible);
  // A right-to-left interface language puts the paragraph direction buttons in the bar.
  const chromeDir = useChromeDir();
  const directionButtons = chromeDir === 'rtl';
  const defaultGroups = useMemo(
    () =>
      buildDefaultGroups(image, directionButtons, { chart: chartPane, shape: shapePane }, chart),
    [image, directionButtons, chartPane, shapePane, chart]
  );
  const defaultSlots = useMemo(
    () => new Set(defaultGroups.flatMap((group) => group.entries.map((entry) => entry.slot))),
    [defaultGroups]
  );
  // Read once per render, before measuring: which groups exist decides what can collapse.
  const parsed = useMemo(
    () =>
      preset
        ? readToolbarChildren<ArrangementKey>(
            children,
            slotOfChild,
            (slot) => defaultSlots.has(slot),
            (slot) => (TABLE_CHROME_SLOTS as readonly string[]).includes(slot)
          )
        : null,
    [preset, children, defaultSlots]
  );
  const arranged = useMemo(
    () => (parsed ? arrangeGroups(defaultGroups, parsed) : []),
    [defaultGroups, parsed]
  );
  const collapsible = useMemo<readonly ToolbarFitGroup[]>(
    () => [
      ...arranged
        .filter((group) => !group.pinned)
        .map((group) => ({ id: group.id, items: groupItems(group, parsed?.overrides) })),
      // Table chrome is one unit: its border controls act together on one target.
      ...(tableChromeVisible
        ? [{ id: TABLE_CONTEXTUAL_GROUP_ID, items: [TABLE_CONTEXTUAL_GROUP_ID] }]
        : []),
    ],
    [arranged, parsed, tableChromeVisible]
  );
  const collapseOrderIds = useMemo(() => {
    const priorities = new Map<string, number>();
    for (const group of arranged) {
      if (group.priority !== undefined) priorities.set(group.id, group.priority);
    }
    return collapseOrder(
      collapsible.map((group) => group.id),
      TOOLBAR_COLLAPSE_ORDER,
      priorities
    );
  }, [arranged, collapsible]);

  // Only the preset arrangement has groups to collapse; `preset={false}` is the host's own
  // markup, and moving pieces of it into a menu would be the library rearranging a bar it
  // does not own.
  const measuring = preset && overflowEnabled;
  const { attach, overflow } = useToolbarOverflow(measuring, collapsible, collapseOrderIds);

  let content: ReactNode;
  if (!parsed) {
    content = children;
  } else {
    const { overrides, tableOverrides, appended } = parsed;

    const render = (entry: DefaultEntry): ReactNode => {
      // A `hidden` override renders null where it stands, removing the slot.
      const override = overrides.get(entry.slot);
      if (override) return override;
      const Part = entry.Part;
      return <Part />;
    };

    const renderTable = (entry: DefaultEntry): ReactNode => {
      const override = tableOverrides.get(entry.slot);
      if (override) return override;
      const Part = entry.Part;
      return <Part />;
    };

    const bar: ReactNode[] = [];
    const sections: ToolbarOverflowSection[] = [];
    let drawn = 0;
    for (const group of arranged) {
      // The group's controls in bar order. When the bar runs out of width they leave from the
      // END, one at a time, so the bar keeps a prefix and "⋯" holds the rest, in bar order.
      const items = groupItems(group, overrides);
      const entryBySlot = new Map<string, DefaultEntry>(
        group.entries.map((entry) => [entry.slot, entry])
      );
      const shown = group.pinned
        ? items.length
        : toolbarShownCount(overflow, group.id, items.length);
      const hidden = items.slice(shown);
      if (hidden.length > 0) {
        const rows = hidden.flatMap((item) => {
          const entry = entryBySlot.get(item);
          if (!entry) return [];
          const row = overflowRow(entry, overrides, label, group.labelKey, render);
          if (row === null) return [];
          return [<Fragment key={entry.slot}>{row}</Fragment>];
        });
        const extra = toolbarHostPanelShown(group.extras.length > 0, hidden)
          ? hostPanelContent(group)
          : null;
        if (extra !== null) rows.push(<Fragment key="host">{extra}</Fragment>);
        if (rows.length > 0) {
          sections.push({
            id: group.id,
            labelKey: group.labelKey,
            ...(group.heading ? { label: hostGroupText(group.heading, label) } : {}),
            children: rows,
          });
        }
      }
      if (shown === 0) continue;
      // The separator belongs BETWEEN what is on screen. Keyed on the group so a collapse
      // does not renumber the ones that stayed.
      if (drawn > 0) bar.push(<ToolbarSeparator key={`separator-${group.id}`} />);
      drawn += 1;
      bar.push(
        <div
          key={group.id}
          className={`docx-toolbar__group${group.className ? ` ${group.className}` : ''}`}
          {...(group.heading
            ? { role: 'group', 'aria-label': hostGroupText(group.heading, label) }
            : {})}
          // Pinned groups are costed as fixed width rather than offered to the fit.
          {...(group.pinned ? { [FIXED_ATTRIBUTE]: '' } : { [GROUP_ATTRIBUTE]: group.id })}
        >
          {items.slice(0, shown).map((item) => {
            const entry = entryBySlot.get(item);
            return (
              <div key={item} className="docx-toolbar__item" {...{ [ITEM_ATTRIBUTE]: item }}>
                {entry ? render(entry) : group.extras}
              </div>
            );
          })}
        </div>
      );
    }

    // The selected object's own groups lead the menu, under the table controls.
    const ordered = orderToolbarOverflowSections(sections);
    const tableOverflowed = overflow.has(TABLE_CONTEXTUAL_GROUP_ID);
    if (tableChromeVisible && tableOverflowed) {
      const rows = TABLE_CONTEXTUAL_GROUP.entries.flatMap((entry) => {
        const row = overflowRow(
          entry,
          tableOverrides,
          label,
          TABLE_CONTEXTUAL_GROUP.labelKey,
          renderTable
        );
        return row === null ? [] : [<Fragment key={entry.slot}>{row}</Fragment>];
      });
      if (rows.length > 0) {
        // Keep contextual controls at the top of More. Table pickers render inside the
        // panel, so their trigger must remain visible when opening one temporarily lifts
        // the panel's scroll clipping.
        ordered.unshift({
          id: TABLE_CONTEXTUAL_GROUP.id,
          labelKey: TABLE_CONTEXTUAL_GROUP.labelKey,
          children: rows,
        });
      }
    }

    content = (
      <>
        {bar}
        {tableChromeVisible && !tableOverflowed ? (
          <ToolbarSeparator key="separator-contextual-table" />
        ) : null}
        {!tableOverflowed ? (
          <div
            className="docx-toolbar__contextual"
            {...{ [GROUP_ATTRIBUTE]: TABLE_CONTEXTUAL_GROUP_ID }}
          >
            <TableChromeGroup overrides={tableOverrides} separator={false} />
          </div>
        ) : null}
        {appended.length > 0 ? (
          // Loose host children never collapse: they have no group, and so no label for a
          // panel section. They are costed as fixed width like a pinned group. A host that
          // wants them to collapse puts them in a `Toolbar.Group`.
          <div className="docx-toolbar__group" {...{ [FIXED_ATTRIBUTE]: '' }}>
            {appended}
          </div>
        ) : null}
        {ordered.length > 0 ? <ToolbarOverflow sections={ordered} /> : null}
      </>
    );
  }

  return (
    <ToolbarContext.Provider value={context}>
      {/* OUTSIDE the measured element on purpose: the bar measures its own children to
          decide what collapses into the overflow panel, and a dialog counted among them
          fed that measurement — the panel re-measured, the dialog re-rendered, forever. */}
      <ParagraphDialogHost>
        <fieldset
          ref={attach}
          disabled={toolbarDisabled}
          aria-label={label('formattingBar.label')}
          data-testid="docx-toolbar"
          // `docx-editor` self-emitted: chrome CSS and --doc-* tokens are scoped under it, and
          // `Root` renders no DOM — same pattern as `DocxEditorLoading`/`DocxEditorViewport`,
          // so a composed toolbar is styled wherever the host puts it. Nesting under the
          // packaged wrapper is fine; the stylesheet re-applies dark tokens to nested roots.
          className={`${scopeClassName}docx-toolbar${className ? ` ${className}` : ''}`}
          dir={chromeDir}
          // One row when the bar measures itself, wrapping when it does not: the stylesheet
          // reads this rather than guessing from a breakpoint.
          {...(measuring ? { 'data-overflow': '' } : {})}
          // Container-level caret guard (CLAUDE.md focus-stealing pitfall): a disabled
          // button never receives mousedown, so per-button handlers cannot cover it.
          // Form fields are exempt inside the guard itself.
          onMouseDown={guardToolbarMousedown}
        >
          {/* The bar carries the scope class, and its shape and chart parts render compact. */}
          <ScopedByAncestorContext.Provider value={true}>
            <ObjectControlVariantContext.Provider value="compact">
              {includesTableChromeParts(children, preset) ? (
                <TableChromeProvider>{content}</TableChromeProvider>
              ) : (
                content
              )}
            </ObjectControlVariantContext.Provider>
          </ScopedByAncestorContext.Provider>
        </fieldset>
      </ParagraphDialogHost>
    </ToolbarContext.Provider>
  );
}

/** True when an override child removes its slot from the arrangement. */
function isHiddenOverride(override: ReactElement | undefined): boolean {
  if (!override) return false;
  if (override.type === Fragment) {
    const nested = Children.toArray(
      (override.props as { children?: DocxEditorChildren }).children
    ).find((child) => slotOfChild(child) !== null);
    return isValidElement(nested) ? isHiddenOverride(nested) : false;
  }
  return Boolean((override.props as { hidden?: boolean }).hidden);
}

/**
 * A group's collapsible controls, in bar order (see core's `toolbarGroupItems`). A slot removed
 * with `hidden` takes no place.
 */
function groupItems(
  group: ArrangedGroup,
  overrides: ReadonlyMap<ArrangementKey, ReactElement> | undefined
): readonly string[] {
  const slots = group.entries
    .filter((entry) => !isHiddenOverride(overrides?.get(entry.slot)))
    .map((entry) => entry.slot);
  return toolbarGroupItems(slots, group.extras.length > 0);
}

type HostGroupHeading = Pick<DocxEditorToolbarGroupProps, 'id' | 'label' | 'labelKey'>;

/** A group as the preset bar renders it: built-in or host-owned, in bar order. */
interface ArrangedGroup {
  readonly id: string;
  /** Panel heading key of a built-in group. */
  readonly labelKey: string;
  /** A host group's heading props, resolved with the toolbar's `t` at render. */
  readonly heading: HostGroupHeading | undefined;
  readonly entries: readonly DefaultEntry[];
  /** Host content: a host group's children, or controls added to a built-in group. */
  readonly extras: readonly ReactNode[];
  readonly pinned: boolean;
  readonly priority: number | undefined;
  readonly overflowContent: (() => DocxEditorChildren) | undefined;
  readonly className: string | undefined;
  readonly host: boolean;
}

/**
 * The bar's groups: the built-in ones with their `Toolbar.Group` changes applied, and the
 * host's own groups placed by {@link arrangeToolbarGroups}. A group with nothing left to
 * render (hidden, or every slot hidden and no host content) is dropped, so it leaves no
 * empty box and no separator in the bar or the panel.
 */
function arrangeGroups(
  defaultGroups: readonly DefaultGroup[],
  parsed: ToolbarChildren<ArrangementKey>
): readonly ArrangedGroup[] {
  const specs = new Map(parsed.groups.map((spec) => [spec.id, spec]));
  const builtInIds = new Set(defaultGroups.map((group) => group.id));
  const byId = new Map<string, ArrangedGroup>();
  for (const group of defaultGroups) {
    const spec = specs.get(group.id);
    if (spec) warnBuiltInGroupProps(spec);
    if (spec?.hidden) continue;
    // Children that all render nothing (`false`, `null`) are no content.
    const extras = Children.toArray(spec?.children);
    const visible = group.entries.some(
      (entry) => !isHiddenOverride(parsed.overrides.get(entry.slot))
    );
    if (!visible && extras.length === 0) continue;
    byId.set(group.id, {
      id: group.id,
      labelKey: group.labelKey,
      heading: undefined,
      entries: group.entries,
      extras,
      pinned: spec?.pinned ?? TOOLBAR_PINNED_GROUPS.has(group.id),
      priority: spec?.priority,
      overflowContent: spec?.overflowContent,
      className: spec?.className,
      host: false,
    });
  }
  for (const spec of parsed.groups) {
    if (spec.id === TABLE_CONTEXTUAL_GROUP_ID) warnReservedGroupId(spec.id);
  }
  const hosts = parsed.groups.filter(
    (spec) => !builtInIds.has(spec.id) && spec.id !== TABLE_CONTEXTUAL_GROUP_ID
  );
  for (const spec of hosts) {
    const extras = Children.toArray(spec.children);
    if (spec.hidden || extras.length === 0) continue;
    byId.set(spec.id, {
      id: spec.id,
      labelKey: spec.labelKey ?? spec.id,
      heading: { id: spec.id, label: spec.label, labelKey: spec.labelKey },
      entries: [],
      extras,
      pinned: spec.pinned === true,
      priority: spec.priority,
      overflowContent: spec.overflowContent,
      className: spec.className,
      host: true,
    });
  }
  const known = [...builtInIds, ...hosts.map((spec) => spec.id)];
  for (const spec of hosts) {
    if (spec.after !== undefined && !known.includes(spec.after)) {
      warnUnknownGroupAnchor(spec.id, spec.after, known);
    }
  }
  for (const child of parsed.appended) {
    // A `Toolbar.Slot` exists only to take a slot's place, so landing here is a mistake.
    if (!isValidElement(child) || child.type !== ToolbarSlot) continue;
    const slot = (child.props as { slotId: ChromeSlotId }).slotId;
    warnSlotOutsideArrangement(slot, chromeControlForSlot(slot) !== null);
  }
  // Placed over EVERY built-in id, hidden ones included, so `after` still finds its anchor.
  const order = arrangeToolbarGroups(
    defaultGroups.map((group) => group.id),
    hosts.map((spec) => ({ id: spec.id, after: spec.after }))
  );
  return order.flatMap((id) => {
    const group = byId.get(id);
    return group ? [group] : [];
  });
}

/** Props of a built-in `Toolbar.Group` that only a host group uses. */
function warnBuiltInGroupProps(
  spec: Pick<DocxEditorToolbarGroupProps, 'id' | 'label' | 'labelKey' | 'after'>
): void {
  for (const setting of ['label', 'labelKey', 'after'] as const) {
    if (spec[setting] !== undefined) warnBuiltInGroupSetting(spec.id, setting);
  }
}

/** A collapsed group's host content in the panel, or null when it has none. */
function hostPanelContent(group: ArrangedGroup): ReactNode {
  // `overflowContent` renders even without children, so a built-in group can add a panel
  // row of its own.
  if (group.overflowContent) return group.overflowContent();
  if (group.extras.length === 0) return null;
  return (
    <ToolbarPlacementContext.Provider value="panel">
      <div className="docx-toolbar__more-host">{group.extras}</div>
    </ToolbarPlacementContext.Provider>
  );
}

/** One row in a collapsed group's overflow panel, or null when hidden. */
function overflowRow(
  entry: DefaultEntry,
  overrides: Map<ArrangementKey, ReactElement>,
  label: (key: string) => string,
  groupLabelKey: string,
  render: (entry: DefaultEntry) => DocxEditorChildren
): ReactNode {
  const override = overrides.get(entry.slot);
  if (isHiddenOverride(override)) return null;
  // A `Toolbar.Slot` may give its own panel content.
  const panelContent =
    override?.type === ToolbarSlot
      ? (override.props as { overflowContent?: () => DocxEditorChildren }).overflowContent
      : undefined;
  // Parts that open a dialog, menu, or popover draw their own full-width row, so the whole
  // row presses the control. Their popups stay inside the part, as in the bar.
  if (!override && PANEL_ROW_SLOTS.has(entry.slot)) {
    return (
      <ToolbarPlacementContext.Provider value="panel">
        {render(entry)}
      </ToolbarPlacementContext.Provider>
    );
  }
  if (override || isValueSlot(entry.slot)) {
    return (
      <ToolbarOverflowControl label={labelOf(label, entry, groupLabelKey)}>
        {panelContent ? panelContent() : render(entry)}
      </ToolbarOverflowControl>
    );
  }
  return <ToolbarOverflowItem slot={entry.slot as ChromeSlotId} />;
}

/** A panel control row's label: the slot's own registry label, else its group's. */
function labelOf(
  label: (key: string) => string,
  entry: DefaultEntry,
  groupLabelKey: string
): string {
  const control = entry.slot === 'alignment' ? null : chromeControlForSlot(entry.slot);
  return label(control?.labelKey ?? groupLabelKey);
}

/** The toolbar with its parts attached as statics. @public */
export interface DocxEditorToolbarNamespace {
  (props: DocxEditorToolbarProps): ReactNode;
  readonly Button: typeof ToolbarButton;
  /** A host-owned action the chrome registry does not describe. */
  readonly Action: typeof ToolbarAction;
  readonly Separator: typeof ToolbarSeparator;
  /**
   * A group of the preset bar: host content that is measured and collapses into the "⋯"
   * panel, or, with a built-in id, controls added to that group or the group hidden.
   */
  readonly Group: typeof ToolbarHostGroup;
  /** Replaces one built-in slot with arbitrary content, in the slot's place. */
  readonly Slot: typeof ToolbarSlot;
  /** Opens a comment draft on the selection in the review rail. */
  readonly AddComment: typeof ToolbarAddComment;
  readonly Undo: ToolbarPartComponent;
  readonly Redo: ToolbarPartComponent;
  readonly Bold: ToolbarPartComponent;
  readonly Italic: ToolbarPartComponent;
  readonly Underline: ToolbarPartComponent;
  readonly Strike: ToolbarPartComponent;
  readonly Link: ToolbarPartComponent;
  readonly ClearFormatting: ToolbarPartComponent;
  readonly Superscript: ToolbarPartComponent;
  readonly Subscript: ToolbarPartComponent;
  readonly Alignment: ToolbarAlignmentComponent;
  readonly AlignLeft: ToolbarPartComponent;
  readonly AlignCenter: ToolbarPartComponent;
  readonly AlignRight: ToolbarPartComponent;
  readonly AlignJustify: ToolbarPartComponent;
  readonly LeftToRight: ToolbarPartComponent;
  readonly RightToLeft: ToolbarPartComponent;
  readonly LineSpacing: ToolbarSlotPartComponent;
  readonly BulletList: ToolbarPartComponent;
  readonly NumberedList: ToolbarPartComponent;
  readonly Outdent: ToolbarPartComponent;
  readonly Indent: ToolbarPartComponent;
  readonly ImageInsert: ToolbarPartComponent;
  readonly ImageProperties: ToolbarPartComponent;
  readonly ImageWrap: ImageWrapPartComponent;
  /** The Insert chart dropdown (`insert.chart`). */
  readonly ChartInsert: ChartInsertPartComponent;
  readonly ImageAltText: ImageAltTextPartComponent;
  readonly TableInsert: ToolbarPartComponent;
  /** Border-edge target picker compound for contextual table chrome. */
  readonly TableBorderTarget: TableBorderTargetNamespace;
  /** Border-colour split compound (quick-apply main + swatch dialog). */
  readonly TableBorderColor: TableBorderColorNamespace;
  /** Border line-style menu compound. */
  readonly TableBorderStyle: TableBorderStyleNamespace;
  /** Border width menu compound. */
  readonly TableBorderWidth: TableBorderWidthNamespace;
  /** Cell background fill split compound (quick-apply main + swatch dialog). */
  readonly TableCellFill: TableCellFillNamespace;
  /** Merge the selected cells. */
  readonly TableMergeCells: ToolbarPartComponent;
  /** Open the Split cells dialog. */
  readonly TableSplitCell: ToolbarPartComponent;
  readonly Comments: ToolbarPartComponent;
  readonly FontFamily: typeof FontFamily;
  readonly FontSize: ToolbarSlotPartComponent;
  readonly FontColor: ToolbarColorSplitComponent;
  readonly Highlight: ToolbarColorSplitComponent;
  readonly Zoom: ToolbarSlotPartComponent;
  readonly StylePicker: typeof ParagraphStyle;
  readonly EditingMode: ToolbarSlotPartComponent;
  readonly Reviewers: typeof ToolbarReviewers;
  readonly Save: ToolbarSlotPartComponent;
  readonly ContentControlShowAll: ToolbarPartComponent;
  readonly ContentControlFormFill: ToolbarPartComponent;
  readonly ContentControlInspector: ToolbarPartComponent;
  readonly ContentControlRemove: ToolbarPartComponent;
}

/**
 * The compound toolbar: `<DocxEditor.Toolbar/>` for the full working chrome, parts as
 * statics for composition (`<DocxEditor.Toolbar><DocxEditor.Toolbar.Bold/>...`).
 *
 * @public
 */
export const DocxEditorToolbar: DocxEditorToolbarNamespace = Object.assign(DocxEditorToolbarRoot, {
  Button: ToolbarButton,
  Action: ToolbarAction,
  Separator: ToolbarSeparator,
  Group: ToolbarHostGroup,
  Slot: ToolbarSlot,
  AddComment: ToolbarAddComment,
  Undo: ToolbarUndo,
  Redo: ToolbarRedo,
  Bold: ToolbarBold,
  Italic: ToolbarItalic,
  Underline: ToolbarUnderline,
  Strike: ToolbarStrike,
  Link: ToolbarLink,
  ClearFormatting: ToolbarClearFormatting,
  Superscript: ToolbarSuperscript,
  Subscript: ToolbarSubscript,
  Alignment: ToolbarAlignment,
  AlignLeft: ToolbarAlignLeft,
  AlignCenter: ToolbarAlignCenter,
  AlignRight: ToolbarAlignRight,
  AlignJustify: ToolbarAlignJustify,
  LeftToRight: ToolbarLeftToRight,
  RightToLeft: ToolbarRightToLeft,
  LineSpacing: ToolbarLineSpacing,
  BulletList: ToolbarBulletList,
  NumberedList: ToolbarNumberedList,
  Outdent: ToolbarOutdent,
  Indent: ToolbarIndent,
  ImageInsert: ToolbarImageInsert,
  ImageProperties: ToolbarImageProperties,
  ImageWrap: ToolbarImageWrap,
  ChartInsert: ToolbarChartInsert,
  ImageAltText: ToolbarImageAltText,
  TableInsert: ToolbarTableInsert,
  TableBorderTarget: ToolbarTableBorderTarget,
  TableBorderColor: ToolbarTableBorderColor,
  TableBorderStyle: ToolbarTableBorderStyle,
  TableBorderWidth: ToolbarTableBorderWidth,
  TableCellFill: ToolbarTableCellFill,
  TableMergeCells: ToolbarTableMergeCells,
  TableSplitCell: ToolbarTableSplitCell,
  Comments: ToolbarComments,
  FontFamily,
  FontSize: ToolbarFontSize,
  FontColor: ToolbarFontColor,
  Highlight: ToolbarHighlight,
  Zoom: ToolbarZoom,
  StylePicker: ParagraphStyle,
  EditingMode: ToolbarEditingMode,
  Reviewers: ToolbarReviewers,
  Save: ToolbarSave,
  ContentControlShowAll: ToolbarContentControlShowAll,
  ContentControlFormFill: ToolbarContentControlFormFill,
  ContentControlInspector: ToolbarContentControlInspector,
  ContentControlRemove: ToolbarContentControlRemove,
});

export { useFontFamily, useParagraphStyle };

// Content-control chrome: the boundary boxes, alias tab and value widget painted over a page
// sheet for every control the layout placed on it. Split out of `semantic-paint.ts` so the
// furniture geometry (where the chip sits, how it scales) lives next to the record it reads.

import type {
  ContentControlBoundaryRecord,
  ContentControlMappedType,
  PageRecord,
} from '@docx-editor.dev/core/layout';
import type { PaintOptions } from './semantic-paint.ts';

/**
 * Height of the control label tab, in SCREEN pixels: `.docx-content-control-label` is 14px of
 * line-height plus 1px of padding each side, and its font does not scale with the zoom.
 *
 * The two have to agree. A mismatch shows up as a gap or an overlap where the tab meets the box
 * it labels, and only at a zoom nobody tested at.
 */
const CONTROL_LABEL_HEIGHT = 16;

/**
 * Side of the value widget at 100% zoom, in layout points. Unlike the label tab it is DOCUMENT
 * furniture — Word draws its drop-down tab at the control's own size — so it scales with the
 * page, and the stylesheet draws the glyph in `em` off the size painted here.
 */
export const CONTROL_WIDGET_SIZE = 16;
/** Gap between a control's right edge and its widget, in layout points. */
export const CONTROL_WIDGET_GAP = 2;

/** Widget kinds the painted surface can activate without adapter chrome. */
const WIDGET_TYPES = new Set<ContentControlMappedType>([
  'dropdown',
  'comboBox',
  'date',
  'checkbox',
  'picture',
  'buildingBlockGallery',
]);

/**
 * Paint on-demand content-control boundary furniture onto a page sheet.
 *
 * Absolute-positioned over the sheet (page coordinates), never inside flowing content —
 * so toggling chrome cannot reflow. `data-docx-marker` excludes the nodes from native
 * selection mapping; `contenteditable=false` keeps them furniture.
 */
export function paintContentControlChrome(
  document: Document,
  pageElement: HTMLElement,
  page: PageRecord,
  options: {
    readonly scale: number;
    readonly contentControlChrome?: PaintOptions['contentControlChrome'];
  }
): void {
  const chrome = options.contentControlChrome;
  const suppressed = chrome?.suppressedIds;
  const pageControls = (page.contentControls ?? []).filter(
    (control) => suppressed?.has(control.id) !== true
  );
  const controls = [
    ...pageControls,
    ...(chrome?.additionalBoundaries ?? []).filter(
      (candidate) =>
        suppressed?.has(candidate.id) !== true &&
        !pageControls.some((control) => control.id === candidate.id)
    ),
  ];
  if (controls.length === 0) return;
  const showAll = chrome?.showAll === true;
  const activeIds = chrome?.activeIds;
  const hoverIds = chrome?.hoverIds;
  const tocControlIds = chrome?.tocControlIds;
  for (const control of controls) {
    const isToc = tocControlIds?.has(control.id) === true;
    const active = !isToc && activeIds?.has(control.id) === true;
    const hovered = hoverIds?.has(control.id) === true;
    pageElement.append(
      paintContentControlBoundary(
        document,
        page,
        control,
        options.scale,
        active,
        hovered,
        showAll || active || (isToc && hovered),
        chrome?.checkedIds?.has(control.id),
        isToc,
        chrome?.readOnly === true
      )
    );
  }
}

/** Where a control's widget lands, in sheet pixels. */
export interface ContentControlWidgetBox {
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

/**
 * Widget geometry for the first fragment of a control on a page.
 *
 * A value widget (drop-down arrow, calendar) sits OUTSIDE the control, past its right edge,
 * the way Word attaches its tab: painting it inside covered the last characters of the value,
 * and an empty control put it over whatever text came before. It only folds back inside the
 * control when the page has no room to its right. A checkbox is its own glyph, so its widget
 * covers the glyph box exactly and grows with the font and the zoom.
 */
export function contentControlWidgetBox(
  page: PageRecord,
  fragment: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  controlType: ContentControlMappedType,
  scale: number
): ContentControlWidgetBox {
  const contentLeft = page.contentBox.x - page.box.x;
  const contentTop = page.contentBox.y - page.box.y;
  if (controlType === 'checkbox') {
    // The fragment is the LINE box, which a tall neighbour or wide line spacing inflates; the
    // widget must stay glyph-sized, or it swallows presses meant for the text beside it.
    const size = Math.max(1, Math.min(fragment.height, CONTROL_WIDGET_SIZE)) * scale;
    // A `w:sym` glyph (Word's own checkbox shape) has no model width: its fragment is a
    // zero-width box at the insertion point and the glyph paints to the RIGHT of it, so the
    // widget starts there. A text glyph has a real box and the widget centres on it.
    const left =
      fragment.width > 0
        ? (contentLeft + fragment.x + fragment.width / 2) * scale - size / 2
        : (contentLeft + fragment.x) * scale;
    const top =
      (contentTop + fragment.y) * scale + Math.max(0, (fragment.height * scale - size) / 2);
    return { left, top, size };
  }
  const size = CONTROL_WIDGET_SIZE * scale;
  const right = (contentLeft + fragment.x + fragment.width) * scale;
  // A block control fills the text column, so its widget lands in the page margin, which is
  // still on the sheet; only a control at the sheet's own edge folds back inside.
  const sheetRight = page.box.width * scale;
  const outside = right + CONTROL_WIDGET_GAP * scale;
  const left = outside + size <= sheetRight ? outside : Math.max(0, right - size);
  const top = (contentTop + fragment.y) * scale + Math.max(0, (fragment.height * scale - size) / 2);
  return { left, top, size };
}

function paintContentControlBoundary(
  document: Document,
  page: PageRecord,
  control: ContentControlBoundaryRecord,
  scale: number,
  active: boolean,
  hovered: boolean,
  boundaryVisible: boolean,
  checked: boolean | undefined,
  isToc: boolean,
  readOnly: boolean
): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'docx-content-control-chrome';
  layer.dataset.docxContentControl = control.id;
  layer.dataset.docxMarker = '';
  layer.dataset.controlType = control.controlType;
  layer.dataset.lock = control.effectiveLock;
  if (control.bound) layer.dataset.bound = '';
  if (control.placeholder) layer.dataset.placeholder = '';
  if (isToc) layer.dataset.docxToc = '';
  // Lets the stylesheet drop the "fill me in" hover invite without a second source of truth
  // for what read-only means.
  if (readOnly) layer.dataset.readOnly = '';
  if (active) layer.dataset.active = '';
  if (hovered) layer.dataset.hover = '';
  if (boundaryVisible) layer.dataset.boundaryVisible = '';
  layer.setAttribute('contenteditable', 'false');
  layer.setAttribute('role', 'group');
  // Alias and tag are document-authored control metadata.
  if (control.alias) layer.dataset.alias = control.alias;
  if (control.tag) layer.dataset.tag = control.tag;
  if (control.alias) layer.setAttribute('aria-label', control.alias);
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '2';

  // Boundary fragments use the same page-CONTENT coordinate space as paragraph/table
  // fragments. This chrome layer is parented to the SHEET so it does not affect editable
  // content or DOM-selection child indices, therefore translate through the content-box
  // origin before painting. Omitting this offset puts every control in the page's top-left
  // margin (and is especially obvious for controls inside table cells).
  const contentLeft = page.contentBox.x - page.box.x;
  const contentTop = page.contentBox.y - page.box.y;
  for (const fragment of control.fragments) {
    if (fragment.pageIndex !== page.index) continue;
    const box = document.createElement('div');
    box.className = 'docx-content-control-boundary';
    box.dataset.docxMarker = '';
    box.setAttribute('contenteditable', 'false');
    box.setAttribute('aria-hidden', 'true');
    box.style.position = 'absolute';
    box.style.left = `${(contentLeft + fragment.box.x) * scale}px`;
    box.style.top = `${(contentTop + fragment.box.y) * scale}px`;
    box.style.width = `${Math.max(fragment.box.width, 1) * scale}px`;
    box.style.height = `${Math.max(fragment.box.height, 1) * scale}px`;
    box.style.pointerEvents = 'none';
    layer.append(box);
  }

  const first = control.fragments.find((fragment) => fragment.pageIndex === page.index);
  if (first && control.alias) {
    const label = document.createElement('div');
    label.className = 'docx-content-control-label';
    label.dataset.docxMarker = '';
    label.setAttribute('contenteditable', 'false');
    label.setAttribute('aria-hidden', 'true');
    label.textContent = control.alias;
    label.style.position = 'absolute';
    label.style.left = `${(contentLeft + first.box.x) * scale}px`;
    // The box position scales; the OFFSET does not, and that is deliberate. The label is
    // chrome, not content: its font is a fixed 10px/14px, so the tab is `CONTROL_LABEL_HEIGHT`
    // screen pixels tall at every zoom. Subtracting a scaled height would open a gap between
    // the tab and the box it labels, widening as the reader zooms in.
    label.style.top = `${Math.max(0, (contentTop + first.box.y) * scale - CONTROL_LABEL_HEIGHT)}px`;
    label.style.pointerEvents = 'none';
    layer.append(label);
  }
  if (first && WIDGET_TYPES.has(control.controlType)) {
    const widget = document.createElement('button');
    widget.type = 'button';
    widget.className = 'docx-content-control-widget';
    widget.dataset.docxMarker = '';
    widget.dataset.docxCcWidget = control.controlType;
    widget.dataset.docxCcId = control.id;
    widget.setAttribute('contenteditable', 'false');
    widget.setAttribute('tabindex', '-1');
    // Role / name / value come from data + state; adapters localize labels.
    if (control.controlType === 'checkbox') widget.setAttribute('role', 'checkbox');
    else if (
      control.controlType === 'dropdown' ||
      control.controlType === 'comboBox' ||
      control.controlType === 'buildingBlockGallery'
    ) {
      widget.setAttribute('role', 'listbox');
    } else if (control.controlType === 'date' || control.controlType === 'picture') {
      widget.setAttribute('role', 'button');
    }
    if (control.alias) widget.dataset.name = control.alias;
    if (control.alias) widget.setAttribute('aria-label', control.alias);
    if (control.controlType === 'checkbox') {
      widget.setAttribute('data-checked', checked ? 'true' : 'false');
      widget.setAttribute('aria-checked', checked ? 'true' : 'false');
    }
    const contentLocked =
      control.effectiveLock === 'contentLocked' || control.effectiveLock === 'sdtContentLocked';
    // Mode first: a document nobody may write has no writable control in it, whatever the
    // control's own lock says.
    if (readOnly || contentLocked || control.bound) {
      widget.disabled = true;
      widget.dataset.disabledReason = readOnly ? 'readOnly' : control.bound ? 'bound' : 'locked';
      widget.setAttribute('aria-disabled', 'true');
    }
    const box = contentControlWidgetBox(page, first.box, control.controlType, scale);
    widget.style.position = 'absolute';
    widget.style.left = `${box.left}px`;
    widget.style.top = `${box.top}px`;
    widget.style.width = `${box.size}px`;
    widget.style.height = `${box.size}px`;
    // The stylesheet draws the glyph in `em`, so one font-size carries the zoom into it.
    widget.style.fontSize = `${box.size}px`;
    widget.style.pointerEvents = 'auto';
    widget.style.padding = '0';
    widget.style.margin = '0';
    widget.style.cursor = widget.disabled ? 'not-allowed' : 'pointer';
    layer.append(widget);
  }

  return layer;
}

import {
  buildingBlocksForControl,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import type { ContentControlWidgetSession } from './popup-sessions.ts';

interface Host {
  find(id: string): OoxmlElement | null;
  allowed(id: string): boolean;
  apply(id: string, value: string): boolean;
  items(id: string): readonly { displayText: string; value: string }[];
  date(id: string): string | undefined;
  checked(id: string): boolean;
  /** The drawing a picture control holds, or undefined when it holds none. */
  picture(id: string): string | undefined;
  /** Replace a picture control's image; false when refused. */
  replaceImage(id: string, bytes: Uint8Array, canCommit: () => boolean): Promise<boolean>;
  locale(): string;
  layer: HTMLElement;
  setOpen(id: string, open: boolean): void;
  request?: ((session: ContentControlWidgetSession) => boolean) | undefined;
}
function valueText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (node.localName === 'sdtPr') return '';
  return node.children.map(valueText).join('');
}
/** The mapped list value, or authored free text. Shared by engine and host sessions. */
export function contentControlWidgetValue(
  control: OoxmlElement | null,
  items: readonly { displayText: string; value: string }[]
): string {
  const displayed = control ? valueText(control) : '';
  return items.find((item) => item.displayText === displayed)?.value ?? displayed;
}
function kindOf(control: OoxmlElement | null): string | undefined {
  const properties = control?.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'sdtPr'
  );
  if (!properties || properties.kind === 'textValue') return;
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === 'dropDownList') return 'dropdown';
    if (child.localName === 'comboBox' || child.localName === 'date') return child.localName;
    if (child.localName === 'checkbox') return 'checkbox';
    if (child.localName === 'picture') return 'picture';
    if (child.localName === 'docPartList') return 'buildingBlockGallery';
  }
}
const SESSION_KINDS: readonly string[] = [
  'dropdown',
  'comboBox',
  'date',
  'checkbox',
  'picture',
  'buildingBlockGallery',
];
/** Typed host sessions over the existing content-control command lane. */
export function createContentControlWidgetSessions(host: Host) {
  let active: { controller: AbortController; id: string } | null = null;
  let destroyed = false;
  const cancel = () => {
    const previous = active;
    active = null;
    if (!previous) return;
    host.setOpen(previous.id, false);
    previous.controller.abort();
  };
  return {
    cancel,
    destroy() {
      destroyed = true;
      cancel();
    },
    open(id: string, kind: string): boolean {
      cancel();
      if (destroyed || !host.request || !SESSION_KINDS.includes(kind)) return false;
      const controller = new AbortController();
      active = { controller, id };
      const isActive = () =>
        !destroyed && active?.controller === controller && !controller.signal.aborted;
      const canApply = () => isActive() && kindOf(host.find(id)) === kind && host.allowed(id);
      const control = host.find(id);
      const items = host.items(id).map((item) => ({ ...item }));
      const value = contentControlWidgetValue(control, items);
      // A picture session stands for the drawing it replaces; without one there is nothing
      // to replace, and the press is refused rather than opened onto nothing.
      const drawingNodeId = kind === 'picture' ? host.picture(id) : undefined;
      if (kind === 'picture' && !drawingNodeId) {
        cancel();
        return false;
      }
      let replacing = false;
      const session: ContentControlWidgetSession = {
        controlId: id,
        kind: kind as ContentControlWidgetSession['kind'],
        items,
        value:
          kind === 'date'
            ? (host.date(id) ?? '')
            : kind === 'checkbox'
              ? String(host.checked(id))
              : kind === 'picture'
                ? drawingNodeId!
                : kind === 'buildingBlockGallery'
                  ? ''
                  : value,
        locale: host.locale(),
        anchor:
          [...host.layer.querySelectorAll<HTMLElement>('[data-docx-content-control]')]
            .find((node) => node.getAttribute('data-docx-content-control') === id)
            ?.querySelector<HTMLElement>('.docx-content-control-boundary') ?? null,
        signal: controller.signal,
        canApply,
        apply(value) {
          if (kind === 'picture' || !canApply() || !host.apply(id, value)) return false;
          if (isActive()) cancel();
          return true;
        },
        cancel() {
          if (isActive()) cancel();
        },
        ...(kind === 'picture'
          ? {
              async replaceImage(bytes: Uint8Array) {
                if (replacing || !canApply()) return false;
                replacing = true;
                try {
                  if (
                    !(await host.replaceImage(
                      id,
                      bytes,
                      () => canApply() && host.picture(id) === drawingNodeId
                    ))
                  )
                    return false;
                  if (isActive()) cancel();
                  return true;
                } finally {
                  replacing = false;
                }
              },
            }
          : {}),
      };
      host.setOpen(id, true);
      if (host.request(session)) return true;
      session.cancel();
      return false;
    },
  };
}

/**
 * The entries a list widget offers: the declared items of a dropdown or combo box, or the
 * glossary's building blocks for a gallery control, each named by its `w:docPartPr/w:name`.
 */
export function contentControlWidgetItems(
  control: OoxmlElement | null,
  pkg?: () => OoxmlPackage
): readonly { displayText: string; value: string }[] {
  if (!control) return [];
  if (pkg && isBuildingBlockGalleryControl(control)) {
    return buildingBlocksForControl(pkg(), control).map((block) => ({
      displayText: block.name,
      value: block.name,
    }));
  }
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (
      (child as { kind?: string }).kind !== 'contentControlProperties' &&
      child.localName !== 'sdtPr'
    ) {
      continue;
    }
    for (const prop of child.children) {
      if (prop.kind === 'textValue') continue;
      if (prop.localName !== 'dropDownList' && prop.localName !== 'comboBox') continue;
      const items: { displayText: string; value: string }[] = [];
      for (const item of prop.children) {
        if (item.kind === 'textValue' || item.localName !== 'listItem') continue;
        const value = item.attributes.find((a) => a.localName === 'value')?.value ?? '';
        const displayText =
          item.attributes.find((a) => a.localName === 'displayText')?.value ?? value;
        items.push({ displayText, value });
      }
      return items;
    }
  }
  return [];
}

export function contentControlWidgetDate(control: OoxmlElement | null): string | undefined {
  if (!control) return undefined;
  for (const child of control.children) {
    if (child.kind !== 'contentControlProperties') continue;
    for (const property of child.children) {
      if (property.kind !== 'contentControlDate') continue;
      return property.attributes.find((attribute) => attribute.localName === 'fullDate')?.value;
    }
  }
  return undefined;
}

/** Whether a control lists a building block gallery (`w:docPartList` in `w:sdtPr`). */
export function isBuildingBlockGalleryControl(control: OoxmlNode | null): boolean {
  return (
    kindOf(control && control.kind !== 'textValue' ? control : null) === 'buildingBlockGallery'
  );
}

/**
 * The ops one widget value stands for: a building block pick for a gallery control (its
 * body resolved from the glossary), the value op for every other control. Null when the
 * gallery has no block of that name, so the surface refuses instead of writing the name as
 * text.
 */
export function contentControlValueOps(
  control: OoxmlElement | null,
  pkg: () => OoxmlPackage,
  controlId: string,
  value: string
): readonly TreeDocOp[] | null {
  if (!control || !isBuildingBlockGalleryControl(control)) {
    return [{ op: 'setContentControlValue', controlId, value }];
  }
  const matches = buildingBlocksForControl(pkg(), control).filter((entry) => entry.name === value);
  const block = matches.length === 1 ? matches[0] : undefined;
  return block
    ? [{ op: 'insertBuildingBlock', controlId, name: block.name, blocks: block.blocks }]
    : null;
}

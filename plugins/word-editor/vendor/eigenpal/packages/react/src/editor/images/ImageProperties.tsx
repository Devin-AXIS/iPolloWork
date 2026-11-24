import { renderPopup } from '../popup-renderer';
import { usePopupConfig } from '../popup-config';
// Image properties dialog — one atomic `setImageProperties` on Apply.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { RefObject } from '../../docx-editor-ref-object';
import type { EditorSnapshot, SelectedImageState } from '@docx-editor.dev/core/contracts/editor';
import type { DrawingPositionInput, ImageWrapTarget } from '@docx-editor.dev/core/editor';
import {
  DRAWING_REL_FROM_H,
  DRAWING_REL_FROM_V,
  hostDocumentOf,
  IMAGE_WRAP_TARGETS,
  positionInputFromPropertiesCommand,
  validateDrawingPositionInput,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChromeDark } from '../color-mode-context';
import { useEditorState } from '../useEditorState';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { PanelRowContent, triggerClassName, usePanelRow } from '../toolbar/panel-row';
import { emuToPoints, pointsToEmu } from './normalizeImageFile';

const selectImage = (snapshot: EditorSnapshot) => snapshot.image;

function dialogFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    (element) => element.offsetParent !== null || element === hostDocumentOf(root).activeElement
  );
}

/**
 * A host may render this public dialog from its own chrome, outside the editor. The
 * packaged rules are anchored to `.docx-editor`, so the overlay carries that class, and
 * `dark` under a dark `Root`, when nothing above it is scoped, the way `DialogFrame` does
 * for native dialogs.
 *
 * Decided in an element ref, not an effect: the panel mounts only once its draft exists,
 * which is a later render than the one that sets `open`. Rendered through `className`, so a
 * colour-mode change re-renders it rather than React dropping a class it did not write.
 */
function useOverlayScope(): {
  readonly ref: (node: HTMLDivElement | null) => void;
  readonly className: string;
} {
  const dark = useChromeDark();
  const [own, setOwn] = useState(false);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) setOwn(!node.parentElement?.closest(dark ? '.docx-editor.dark' : '.docx-editor'));
    },
    [dark]
  );
  return { ref, className: own ? `docx-editor ${dark ? 'dark ' : ''}` : '' };
}

function guardDialogMousedown(event: React.MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Props for `DocxEditor.ImagePropertiesDialog`. @public */
export interface DocxEditorImagePropertiesDialogProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  triggerRef?: RefObject<HTMLElement | null>;
}

interface DraftState {
  widthPoints: string;
  heightPoints: string;
  cropLeft: string;
  cropTop: string;
  cropRight: string;
  cropBottom: string;
  title: string;
  description: string;
  hyperlink: string;
  wrap: ImageWrapTarget;
  lockAspect: boolean;
  positionMode: 'frame' | 'simple';
  horizontalPoints: string;
  verticalPoints: string;
  relativeToH: DrawingPositionInput['relativeToH'];
  relativeToV: DrawingPositionInput['relativeToV'];
}

function positionDraftFrom(
  image: SelectedImageState
): Pick<
  DraftState,
  'positionMode' | 'horizontalPoints' | 'verticalPoints' | 'relativeToH' | 'relativeToV'
> {
  const position = image.position;
  if (!position || image.kind !== 'anchored') {
    return {
      positionMode: 'frame',
      horizontalPoints: '',
      verticalPoints: '',
      relativeToH: 'page',
      relativeToV: 'line',
    };
  }
  if (position.mode === 'simple') {
    return {
      positionMode: 'simple',
      horizontalPoints:
        position.horizontalEmu !== undefined ? String(emuToPoints(position.horizontalEmu)) : '',
      verticalPoints:
        position.verticalEmu !== undefined ? String(emuToPoints(position.verticalEmu)) : '',
      relativeToH: 'page',
      relativeToV: 'line',
    };
  }
  return {
    positionMode: 'frame',
    horizontalPoints:
      position.horizontalEmu !== undefined ? String(emuToPoints(position.horizontalEmu)) : '',
    verticalPoints:
      position.verticalEmu !== undefined ? String(emuToPoints(position.verticalEmu)) : '',
    relativeToH: position.relativeToH ?? 'page',
    relativeToV: position.relativeToV ?? 'line',
  };
}

function positionDraftChanged(draft: DraftState, basis: SelectedImageState): boolean {
  const initial = positionDraftFrom(basis);
  return (
    draft.horizontalPoints !== initial.horizontalPoints ||
    draft.verticalPoints !== initial.verticalPoints ||
    draft.relativeToH !== initial.relativeToH ||
    draft.relativeToV !== initial.relativeToV
  );
}

function parseSignedOffsetPoints(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const emu = pointsToEmu(parsed);
  if (!Number.isInteger(emu)) return null;
  return emu;
}

function parsePositionCommandPayload(
  draft: DraftState,
  basis: SelectedImageState
):
  | { ok: true; value: Pick<EditorCommandPositionPayload, keyof EditorCommandPositionPayload> }
  | { ok: false } {
  const initial = positionDraftFrom(basis);
  if (draft.positionMode === 'simple' || basis.position?.mode === 'simple') {
    const horizontalChanged = draft.horizontalPoints !== initial.horizontalPoints;
    const verticalChanged = draft.verticalPoints !== initial.verticalPoints;
    const horizontalEmu = horizontalChanged
      ? parseSignedOffsetPoints(draft.horizontalPoints)
      : basis.position?.horizontalEmu;
    const verticalEmu = verticalChanged
      ? parseSignedOffsetPoints(draft.verticalPoints)
      : basis.position?.verticalEmu;
    if (horizontalChanged && horizontalEmu === null) return { ok: false };
    if (verticalChanged && verticalEmu === null) return { ok: false };
    if (horizontalEmu === undefined || verticalEmu === undefined) return { ok: false };
    return {
      ok: true,
      value: {
        horizontalEmu: horizontalEmu as number,
        verticalEmu: verticalEmu as number,
      },
    };
  }
  const horizontalChanged = draft.horizontalPoints !== initial.horizontalPoints;
  const verticalChanged = draft.verticalPoints !== initial.verticalPoints;
  const relativeHChanged = draft.relativeToH !== initial.relativeToH;
  const relativeVChanged = draft.relativeToV !== initial.relativeToV;
  const horizontalEmu = horizontalChanged
    ? parseSignedOffsetPoints(draft.horizontalPoints)
    : basis.position?.horizontalEmu;
  const verticalEmu = verticalChanged
    ? parseSignedOffsetPoints(draft.verticalPoints)
    : basis.position?.verticalEmu;
  if (horizontalChanged && horizontalEmu === null) return { ok: false };
  if (verticalChanged && verticalEmu === null) return { ok: false };
  return {
    ok: true,
    value: {
      ...(typeof horizontalEmu === 'number' ? { horizontalEmu } : {}),
      ...(typeof verticalEmu === 'number' ? { verticalEmu } : {}),
      ...(relativeHChanged || horizontalChanged || verticalChanged
        ? { relativeToH: draft.relativeToH }
        : {}),
      ...(relativeVChanged || horizontalChanged || verticalChanged
        ? { relativeToV: draft.relativeToV }
        : {}),
    },
  };
}

interface EditorCommandPositionPayload {
  horizontalEmu?: number;
  verticalEmu?: number;
  relativeToH?: string;
  relativeToV?: string;
}

function parsePercent(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

function parsePoints(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Properties dialog for the selected picture.
 *
 * @public
 */
export function DocxEditorImagePropertiesDialog({
  open,
  onClose,
  className,
  triggerRef,
}: DocxEditorImagePropertiesDialogProps) {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const image = useEditorState(selectImage);
  const titleId = useId();
  const wrapSelectId = useId();
  const hyperlinkInputId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<SelectedImageState | null>(null);
  const selectionRef = useRef<{ paragraphId: string; offset: number } | null>(null);
  const packageRevisionRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const overlayScope = useOverlayScope();

  const target = targetRef.current;
  const pictureOnlyDisabled = target?.canCrop === false;
  const resizeDisabled = target?.canResize === false;
  const aspectLockDisabled = target?.locks.changeAspect === true;
  const positionEditable = target?.kind === 'anchored' && target.canMove === true;
  const positionUnavailable = target?.kind === 'inline';
  const positionLocked = target?.kind === 'anchored' && target.canMove === false;

  useEffect(() => {
    if (!open) {
      targetRef.current = null;
      selectionRef.current = null;
      packageRevisionRef.current = null;
      return;
    }
    if (!image) return;
    targetRef.current = image;
    if (editor?.surface) {
      const { anchor } = editor.surface.state().selection;
      selectionRef.current = { paragraphId: anchor.paragraphId, offset: anchor.offset };
      packageRevisionRef.current = editor.surface.session.packageRevision();
    }
    setErrorKey(null);
    const positionDraft = positionDraftFrom(image);
    const cropPercent = image.crop;
    setDraft({
      widthPoints: String(emuToPoints(image.widthEmu)),
      heightPoints: String(emuToPoints(image.heightEmu)),
      cropLeft: String(cropPercent.left),
      cropTop: String(cropPercent.top),
      cropRight: String(cropPercent.right),
      cropBottom: String(cropPercent.bottom),
      title: image.title,
      description: image.description,
      hyperlink: image.hyperlink ?? '',
      wrap: image.wrap,
      lockAspect: image.locks.changeAspect,
      ...positionDraft,
    });
  }, [open, image?.id, image?.widthEmu, image?.heightEmu, editor]);

  const restoreFocus = useCallback(() => {
    triggerRef?.current?.focus();
    editor?.focus();
  }, [editor, triggerRef]);

  const dismiss = useCallback(() => {
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusables = dialogFocusables(dialog);
    const initial =
      focusables.find(
        (element) => element.id === 'image-prop-width' && !element.hasAttribute('disabled')
      ) ??
      focusables.find((element) => !element.hasAttribute('disabled')) ??
      dialog;
    initial.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = dialogFocusables(dialog);
      if (items.length === 0) return;
      const active = hostDocumentOf(dialog).activeElement;
      const currentIndex = items.findIndex((element) => element === active);
      if (currentIndex === -1) return;
      event.preventDefault();
      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + items.length) % items.length
        : (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
    };
    const doc = hostDocumentOf(dialog);
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [open, dismiss]);

  const aspectRatio = useMemo(() => {
    const basis = target ?? image;
    if (!basis || basis.widthEmu <= 0) return 1;
    return basis.widthEmu / basis.heightEmu;
  }, [image, target]);

  const setWidth = useCallback(
    (next: string) => {
      setDraft((current) => {
        if (!current) return current;
        if (!current.lockAspect) return { ...current, widthPoints: next };
        const width = parsePoints(next);
        if (width === null) return { ...current, widthPoints: next };
        const height = Math.round((width / aspectRatio) * 100) / 100;
        return { ...current, widthPoints: next, heightPoints: String(height) };
      });
    },
    [aspectRatio]
  );

  const setHeight = useCallback(
    (next: string) => {
      setDraft((current) => {
        if (!current) return current;
        if (!current.lockAspect) return { ...current, heightPoints: next };
        const height = parsePoints(next);
        if (height === null) return { ...current, heightPoints: next };
        const width = Math.round(height * aspectRatio * 100) / 100;
        return { ...current, widthPoints: String(width), heightPoints: next };
      });
    },
    [aspectRatio]
  );

  const resetNatural = useCallback(() => {
    const basis = targetRef.current;
    if (!basis?.intrinsic) return;
    const width = (basis.intrinsic.pixelWidth * 72) / basis.intrinsic.dpiX;
    const height = (basis.intrinsic.pixelHeight * 72) / basis.intrinsic.dpiY;
    setDraft((current) =>
      current
        ? {
            ...current,
            widthPoints: String(Math.round(width * 100) / 100),
            heightPoints: String(Math.round(height * 100) / 100),
          }
        : current
    );
  }, [image]);

  const apply = useCallback(() => {
    const basis = targetRef.current;
    const capturedSelection = selectionRef.current;
    const capturedRevision = packageRevisionRef.current;
    if (!editor || !basis || !draft || !capturedSelection || capturedRevision === null) return;
    const command: {
      type: 'setImageProperties';
      drawingNodeId: string;
      expectedPackageRevision: number;
      selectionParagraphId: string;
      selectionOffset: number;
      widthEmu?: number;
      heightEmu?: number;
      title?: string;
      description?: string;
      hyperlink?: string | null;
      crop?: { left: number; top: number; right: number; bottom: number };
      wrap?: ImageWrapTarget;
      horizontalEmu?: number;
      verticalEmu?: number;
      relativeToH?: string;
      relativeToV?: string;
    } = {
      type: 'setImageProperties',
      drawingNodeId: basis.id,
      expectedPackageRevision: capturedRevision,
      selectionParagraphId: capturedSelection.paragraphId,
      selectionOffset: capturedSelection.offset,
    };

    if (!resizeDisabled) {
      const width = parsePoints(draft.widthPoints);
      const height = parsePoints(draft.heightPoints);
      if (width === null || height === null) {
        setErrorKey('imageProperties.errors.invalidDimensions');
        return;
      }
      const widthEmu = pointsToEmu(width);
      const heightEmu = pointsToEmu(height);
      if (widthEmu !== basis.widthEmu) command.widthEmu = widthEmu;
      if (heightEmu !== basis.heightEmu) command.heightEmu = heightEmu;
    }

    if (basis.canCrop && !pictureOnlyDisabled) {
      const left = parsePercent(draft.cropLeft);
      const top = parsePercent(draft.cropTop);
      const right = parsePercent(draft.cropRight);
      const bottom = parsePercent(draft.cropBottom);
      if (left === null || top === null || right === null || bottom === null) {
        setErrorKey('imageProperties.errors.invalidCrop');
        return;
      }
      const basisCrop = basis.crop;
      if (
        left !== basisCrop.left ||
        top !== basisCrop.top ||
        right !== basisCrop.right ||
        bottom !== basisCrop.bottom
      ) {
        command.crop = { left, top, right, bottom };
      }
    }

    if (draft.title !== basis.title) command.title = draft.title;
    if (draft.description !== basis.description) command.description = draft.description;
    const trimmedHyperlink = draft.hyperlink.trim();
    if (trimmedHyperlink !== (basis.hyperlink ?? '')) {
      command.hyperlink = trimmedHyperlink === '' ? null : trimmedHyperlink;
    }
    if (basis.canChangeWrap && draft.wrap !== basis.wrap) command.wrap = draft.wrap;

    const canEditPosition = basis.kind === 'anchored' && basis.canMove;
    if (canEditPosition && positionDraftChanged(draft, basis)) {
      const parsed = parsePositionCommandPayload(draft, basis);
      if (!parsed.ok) {
        setErrorKey('imageProperties.errors.invalidPosition');
        return;
      }
      if (!validateDrawingPositionInput(positionInputFromPropertiesCommand(parsed.value, basis))) {
        setErrorKey('imageProperties.errors.invalidPosition');
        return;
      }
      Object.assign(command, parsed.value);
    }

    const hasMutation =
      command.widthEmu !== undefined ||
      command.heightEmu !== undefined ||
      command.title !== undefined ||
      command.description !== undefined ||
      command.hyperlink !== undefined ||
      command.crop !== undefined ||
      command.wrap !== undefined ||
      command.horizontalEmu !== undefined ||
      command.verticalEmu !== undefined ||
      command.relativeToH !== undefined ||
      command.relativeToV !== undefined;
    if (!hasMutation) {
      dismiss();
      return;
    }
    const allowed = editor.can(command);
    if (!allowed.ok) {
      setErrorKey('imageProperties.errors.refused');
      return;
    }
    const result = editor.exec(command);
    if (!result.ok) {
      setErrorKey('imageProperties.errors.refused');
      return;
    }
    dismiss();
  }, [editor, draft, pictureOnlyDisabled, resizeDisabled, dismiss]);

  if (!open || !draft) return null;

  return (
    <div
      ref={overlayScope.ref}
      className={`${overlayScope.className}docx-dialog-overlay${className ? ` ${className}` : ''}`}
      onClick={dismiss}
      onMouseDown={(event) => {
        event.stopPropagation();
        guardDialogMousedown(event);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-docx-modal=""
        aria-labelledby={titleId}
        className="docx-dialog docx-image-properties-dialog"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div id={titleId} className="docx-dialog__header">
          {t('dialogs.imageProperties.title')}
        </div>
        <div className="docx-dialog__body">
          {errorKey ? (
            <p className="docx-dialog__error">
              {t(errorKey as 'imageProperties.errors.invalidDimensions')}
            </p>
          ) : null}
          <section className="docx-dialog__section">
            <div className="docx-dialog__section-label">
              {t('dialogs.imageProperties.dimensions')}
            </div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-prop-width">
                {t('dialogs.imageProperties.widthLabel')}
              </label>
              <input
                id="image-prop-width"
                className="docx-dialog__input"
                value={draft.widthPoints}
                disabled={resizeDisabled}
                onChange={(event) => setWidth(event.target.value)}
              />
              <span className="docx-dialog__unit">{t('imageProperties.units.points')}</span>
            </div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-prop-height">
                {t('dialogs.imageProperties.heightLabel')}
              </label>
              <input
                id="image-prop-height"
                className="docx-dialog__input"
                value={draft.heightPoints}
                disabled={resizeDisabled}
                onChange={(event) => setHeight(event.target.value)}
              />
              <span className="docx-dialog__unit">{t('imageProperties.units.points')}</span>
            </div>
            <label className="docx-dialog__checkbox-row">
              <input
                type="checkbox"
                checked={draft.lockAspect}
                disabled={aspectLockDisabled}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, lockAspect: event.target.checked } : current
                  )
                }
              />
              {t('dialogs.imageProperties.lockAspectRatio')}
            </label>
            <button
              type="button"
              className="docx-dialog__link-button"
              disabled={pictureOnlyDisabled || !target?.intrinsic}
              onClick={resetNatural}
            >
              {t('imageProperties.resetNaturalSize')}
            </button>
          </section>
          <section className="docx-dialog__section">
            <div className="docx-dialog__section-label">{t('imageProperties.position')}</div>
            {positionUnavailable ? (
              <p className="docx-dialog__hint">{t('imageProperties.positionUnavailable')}</p>
            ) : null}
            {positionLocked ? (
              <p className="docx-dialog__hint">{t('imageProperties.positionLocked')}</p>
            ) : null}
            {positionEditable ? (
              <>
                {draft.positionMode === 'frame' ? (
                  <>
                    <div className="docx-dialog__row">
                      <label className="docx-dialog__field-label" htmlFor="image-pos-rel-h">
                        {t('imageProperties.relativeToHorizontal')}
                      </label>
                      <select
                        id="image-pos-rel-h"
                        className="docx-dialog__select"
                        value={draft.relativeToH ?? 'page'}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  relativeToH: event.target
                                    .value as DrawingPositionInput['relativeToH'],
                                }
                              : current
                          )
                        }
                      >
                        {DRAWING_REL_FROM_H.map((frame) => (
                          <option key={frame} value={frame}>
                            {t(
                              `dialogs.imagePosition.relativeOptions.${frame}` as 'dialogs.imagePosition.relativeOptions.page'
                            )}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="docx-dialog__row">
                      <label className="docx-dialog__field-label" htmlFor="image-pos-rel-v">
                        {t('imageProperties.relativeToVertical')}
                      </label>
                      <select
                        id="image-pos-rel-v"
                        className="docx-dialog__select"
                        value={draft.relativeToV ?? 'line'}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  relativeToV: event.target
                                    .value as DrawingPositionInput['relativeToV'],
                                }
                              : current
                          )
                        }
                      >
                        {DRAWING_REL_FROM_V.map((frame) => (
                          <option key={frame} value={frame}>
                            {t(
                              `dialogs.imagePosition.relativeOptions.${frame}` as 'dialogs.imagePosition.relativeOptions.page'
                            )}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : null}
                <div className="docx-dialog__row">
                  <label className="docx-dialog__field-label" htmlFor="image-pos-h">
                    {t('imageProperties.horizontalOffset')}
                  </label>
                  <input
                    id="image-pos-h"
                    className="docx-dialog__input"
                    value={draft.horizontalPoints}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, horizontalPoints: event.target.value } : current
                      )
                    }
                  />
                  <span className="docx-dialog__unit">{t('imageProperties.units.points')}</span>
                </div>
                <div className="docx-dialog__row">
                  <label className="docx-dialog__field-label" htmlFor="image-pos-v">
                    {t('imageProperties.verticalOffset')}
                  </label>
                  <input
                    id="image-pos-v"
                    className="docx-dialog__input"
                    value={draft.verticalPoints}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, verticalPoints: event.target.value } : current
                      )
                    }
                  />
                  <span className="docx-dialog__unit">{t('imageProperties.units.points')}</span>
                </div>
              </>
            ) : null}
          </section>
          <section className="docx-dialog__section">
            <div className="docx-dialog__section-label">{t('dialogs.imageProperties.altText')}</div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-prop-title">
                {t('imageAltText.title')}
              </label>
              <input
                id="image-prop-title"
                className="docx-dialog__input"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, title: event.target.value } : current
                  )
                }
              />
            </div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-prop-description">
                {t('imageAltText.description')}
              </label>
              <textarea
                id="image-prop-description"
                className="docx-dialog__textarea"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, description: event.target.value } : current
                  )
                }
                placeholder={t('dialogs.imageProperties.altTextPlaceholder')}
              />
            </div>
          </section>
          <section className="docx-dialog__section">
            <div className="docx-dialog__section-label">{t('imageProperties.hyperlink')}</div>
            <label className="docx-dialog__field-label" htmlFor={hyperlinkInputId}>
              {t('hyperlinkPopup.urlLabel')}
            </label>
            <input
              id={hyperlinkInputId}
              className="docx-dialog__input docx-dialog__input--full"
              value={draft.hyperlink}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, hyperlink: event.target.value } : current
                )
              }
              placeholder={t('hyperlinkPopup.urlPlaceholder')}
              dir="ltr"
            />
          </section>
          <section className="docx-dialog__section">
            <div className="docx-dialog__section-label">
              {t('dialogs.imageProperties.textWrapping')}
            </div>
            <label className="docx-dialog__field-label" htmlFor={wrapSelectId}>
              {t('formattingBar.imageWrap')}
            </label>
            <select
              id={wrapSelectId}
              className="docx-dialog__select docx-dialog__input--full"
              value={draft.wrap}
              disabled={target?.canChangeWrap === false}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, wrap: event.target.value as ImageWrapTarget } : current
                )
              }
            >
              {IMAGE_WRAP_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {t(`imageWrap.targets.${target}` as 'imageWrap.inline')}
                </option>
              ))}
            </select>
          </section>
          <section className="docx-dialog__section">
            <div className="docx-dialog__section-label">{t('imageProperties.crop')}</div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-crop-left">
                {t('imageProperties.cropLeft')}
              </label>
              <input
                id="image-crop-left"
                className="docx-dialog__input"
                disabled={pictureOnlyDisabled}
                value={draft.cropLeft}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, cropLeft: event.target.value } : current
                  )
                }
              />
            </div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-crop-top">
                {t('imageProperties.cropTop')}
              </label>
              <input
                id="image-crop-top"
                className="docx-dialog__input"
                disabled={pictureOnlyDisabled}
                value={draft.cropTop}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, cropTop: event.target.value } : current
                  )
                }
              />
            </div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-crop-right">
                {t('imageProperties.cropRight')}
              </label>
              <input
                id="image-crop-right"
                className="docx-dialog__input"
                disabled={pictureOnlyDisabled}
                value={draft.cropRight}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, cropRight: event.target.value } : current
                  )
                }
              />
            </div>
            <div className="docx-dialog__row">
              <label className="docx-dialog__field-label" htmlFor="image-crop-bottom">
                {t('imageProperties.cropBottom')}
              </label>
              <input
                id="image-crop-bottom"
                className="docx-dialog__input"
                disabled={pictureOnlyDisabled}
                value={draft.cropBottom}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, cropBottom: event.target.value } : current
                  )
                }
              />
            </div>
            {pictureOnlyDisabled ? (
              <p className="docx-dialog__hint">{t('imageProperties.nonPictureHint')}</p>
            ) : null}
          </section>
        </div>
        <div className="docx-dialog__footer">
          <button type="button" className="docx-dialog__button" onClick={dismiss}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="docx-dialog__button docx-dialog__button--primary"
            onClick={apply}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Props for the toolbar properties trigger. @public */
export interface ImagePropertiesTriggerProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/**
 * Opens the image properties dialog for the selected drawing.
 *
 * @public
 */
export function ImagePropertiesTrigger({
  className,
  hidden,
  asChild,
  children,
}: ImagePropertiesTriggerProps) {
  const popups = usePopupConfig();
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const image = useEditorState(selectImage);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const probe = { type: 'setImageProperties' as const, description: 'probe' };
  const allowed = editor && image ? editor.can(probe) : null;
  const isEnabled = allowed?.ok === true;
  const disabledReason = allowed && !allowed.ok ? allowed.reason : null;
  const panelRow = usePanelRow(asChild, children);

  if (hidden) return null;

  const control = chromeControlForSlot('image.properties');
  const text = t('formattingBar.imagePropertiesShortcut');
  const shared = {
    type: 'button' as const,
    ref: triggerRef,
    className: `${triggerClassName(panelRow)}${className ? ` ${className}` : ''}`,
    'data-slot': 'image.properties',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => setOpen(true),
  };

  return (
    <>
      {asChild ? (
        <Slot {...shared}>{children}</Slot>
      ) : (
        <button {...shared}>
          {panelRow ? (
            <PanelRowContent icon={chromeIcon(control?.paths)} label={text} />
          ) : (
            (children ?? chromeIcon(control?.paths))
          )}
        </button>
      )}
      {open && popups?.imageProperties !== false ? (
        popups?.imageProperties ? (
          renderPopup(popups.imageProperties, { open, onClose: () => setOpen(false), triggerRef })
        ) : (
          <DocxEditorImagePropertiesDialog
            open={open}
            onClose={() => setOpen(false)}
            triggerRef={triggerRef}
          />
        )
      ) : null}
    </>
  );
}

ImagePropertiesTrigger.docxSlot = 'image.properties' as const;

export const ToolbarImageProperties = Object.assign(ImagePropertiesTrigger, {
  docxSlot: 'image.properties' as const,
});

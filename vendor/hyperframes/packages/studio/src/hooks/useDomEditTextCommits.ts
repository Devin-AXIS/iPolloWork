import { commitDomStyles } from "./domStyleCommit";
import { sanitizeRichTextChildren } from "@hyperframes/core/rich-text-sanitize";
import { useCallback, useRef } from "react";
import type { PatchOperation } from "../utils/sourcePatcher";
import {
  isImageBackgroundValue,
  isManualGeometryStyleProperty,
  normalizeDomEditStyleValue,
} from "../utils/studioHelpers";
import {
  injectPreviewGoogleFont,
  injectPreviewImportedFont,
  ensureImportedFontFace,
} from "../utils/studioFontHelpers";
import {
  buildDomEditStylePatchOperation,
  buildDomEditTextPatchOperation,
  buildTextFieldChildLocator,
  findElementForSelection,
  getDomEditTargetKey,
  isTextEditableSelection,
  serializeDomEditTextFields,
  buildDefaultDomEditTextField,
  type DomEditTextField,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import {
  applyTextFieldChildOperations,
  buildTextFieldChildOperations,
} from "./domEditTextFieldCommitOps";
import {
  DomEditPersistUnsupportedTextStructureError,
  reportDomEditPersistFailure,
} from "./domEditPersistFailure";
import {
  bumpDomEditCommitMapVersion,
  bumpDomEditCommitVersion,
  runDomEditCommit,
} from "./domEditCommitRunner";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import type { ResolveDomSelectionOptions } from "./useDomSelection";

// ── Types ──

export interface UseDomEditTextCommitsParams {
  projectId?: string | null;
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  domEditSelection: DomEditSelection | null;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: ResolveDomSelectionOptions,
  ) => Promise<DomEditSelection | null>;
  removeDomTextFieldElement: (selection: DomEditSelection) => Promise<void>;
  persistDomEditOperations: PersistDomEditOperations;
  queueDomEditSave: <T>(save: () => Promise<T>) => Promise<T>;
  resolveImportedFontAsset: (fontFamilyValue: string) => ImportedFontAsset | null;
}

interface DomTextCommitPlan {
  usesSerializedTextFields: boolean;
  nextContent: string;
  childOperations: PatchOperation[] | null;
  operations: PatchOperation[];
}

function buildNextDomTextFields(
  textFields: DomEditTextField[],
  value: string,
  fieldKey?: string,
): DomEditTextField[] {
  if (textFields.length === 0) return [];
  return textFields.map((field) => (field.key === fieldKey ? { ...field, value } : field));
}

function planDomTextCommit(
  originalTextFields: DomEditTextField[],
  nextTextFields: DomEditTextField[],
  plainTextContent: string,
  editedFieldKey?: string,
): DomTextCommitPlan {
  const usesSerializedTextFields =
    nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child");
  const nextContent = usesSerializedTextFields
    ? serializeDomEditTextFields(nextTextFields)
    : plainTextContent;
  const childOperations = usesSerializedTextFields
    ? buildTextFieldChildOperations(originalTextFields, nextTextFields, editedFieldKey)
    : null;
  const operations =
    childOperations ??
    (usesSerializedTextFields ? [] : [buildDomEditTextPatchOperation(nextContent)]);

  return {
    usesSerializedTextFields,
    nextContent,
    childOperations,
    operations,
  };
}

function applyTextCommit(element: HTMLElement, plan: DomTextCommitPlan): () => void {
  if (plan.usesSerializedTextFields) {
    return plan.childOperations
      ? applyTextFieldChildOperations(element, plan.childOperations)
      : () => {};
  }
  const previous = element.textContent;
  element.textContent = plan.nextContent;
  return () => {
    element.textContent = previous;
  };
}

export function findDomTextFieldElement(
  parent: HTMLElement,
  textFields: DomEditTextField[],
  fieldKey: string,
): HTMLElement | null {
  const locator = buildTextFieldChildLocator(textFields, fieldKey);
  if (!locator) return null;
  const target = parent.querySelectorAll(locator.childSelector)[locator.childIndex] ?? null;
  return target?.nodeType === 1 ? (target as HTMLElement) : null;
}

export function textFieldStyleTargetsSelectedElement(source: DomEditTextField["source"]): boolean {
  return source !== "child";
}

async function resyncDomTextSelectionFromPreview(
  doc: Document | null | undefined,
  selection: DomEditSelection,
  activeCompPath: string | null,
  buildDomSelectionFromTarget: UseDomEditTextCommitsParams["buildDomSelectionFromTarget"],
  applyDomSelection: UseDomEditTextCommitsParams["applyDomSelection"],
): Promise<void> {
  if (!doc) return;
  const refreshed = findElementForSelection(doc, selection, activeCompPath);
  if (!refreshed) return;
  const nextSelection = await buildDomSelectionFromTarget(refreshed, { exactTarget: true });
  if (!nextSelection) return;
  applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
}

// ── Hook ──

export function useDomEditTextCommits({
  projectId,
  activeCompPath,
  previewIframeRef,
  showToast,
  domEditSelection,
  applyDomSelection,
  refreshDomEditSelectionFromPreview,
  buildDomSelectionFromTarget,
  removeDomTextFieldElement,
  persistDomEditOperations,
  queueDomEditSave,
  resolveImportedFontAsset,
}: UseDomEditTextCommitsParams) {
  const domTextCommitVersionRef = useRef(0);
  const domStyleCommitVersionRef = useRef(new Map<string, symbol>());

  const {
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
  } = useDomEditAttributeCommits({
    projectId,
    activeCompPath,
    previewIframeRef,
    showToast,
    domEditSelection,
    refreshDomEditSelectionFromPreview,
    persistDomEditOperations,
  });

  const handleDomStyleCommit = useCallback(async (property: string, value: string) => {
    if (!domEditSelection) return;
    await commitDomStyles({
      activeCompPath, previewIframeRef, showToast,
      versions: domStyleCommitVersionRef.current,
      resolveImportedFontAsset,
      persistDomEditOperations: (selection, operations, options) =>
        queueDomEditSave(() => persistDomEditOperations(selection, operations, options)),
      resync: refreshDomEditSelectionFromPreview,
    }, domEditSelection, { [property]: value });
  }, [activeCompPath, domEditSelection, previewIframeRef, showToast, resolveImportedFontAsset,
    persistDomEditOperations, queueDomEditSave, refreshDomEditSelectionFromPreview]);

  const handleDomTextCommit = useCallback(
    async (value: string, fieldKey?: string) => {
      if (!domEditSelection) return;
      if (!isTextEditableSelection(domEditSelection)) return;
      const isLatestTextCommit = bumpDomEditCommitVersion(domTextCommitVersionRef);
      const nextTextFields = buildNextDomTextFields(domEditSelection.textFields, value, fieldKey);
      const textCommit = planDomTextCommit(
        domEditSelection.textFields,
        nextTextFields,
        value,
        fieldKey ?? domEditSelection.textFields[0]?.key,
      );
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let editedElement: HTMLElement | null = null;
      let revertPreview: (() => void) | null = null;

      await runDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, domEditSelection, activeCompPath);
          if (!el) return;
          editedElement = el;
        },
        apply: () => {
          if (!editedElement) return;
          revertPreview = applyTextCommit(editedElement, textCommit);
        },
        persist: () =>
          queueDomEditSave(async () => {
            if (textCommit.usesSerializedTextFields && textCommit.childOperations === null) {
              throw new DomEditPersistUnsupportedTextStructureError();
            }
            await persistDomEditOperations(domEditSelection, textCommit.operations, {
              label: "Edit text",
              skipRefresh: true,
              skipSdkCutover: true,
              shouldSave: isLatestTextCommit,
            });
          }),
        shouldRevert: () => isLatestTextCommit(),
        revert: () => {
          revertPreview?.();
        },
        onError: (error) =>
          reportDomEditPersistFailure(domEditSelection, textCommit.operations, error, showToast),
        shouldResync: isLatestTextCommit,
        resync: () =>
          resyncDomTextSelectionFromPreview(
            doc,
            domEditSelection,
            activeCompPath,
            buildDomSelectionFromTarget,
            applyDomSelection,
          ),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      persistDomEditOperations,
      previewIframeRef,
      queueDomEditSave,
      showToast,
    ],
  );

  const handleDomInnerHtmlCommit = useCallback(
    async (selection: DomEditSelection, value: string) => {
      if (!isTextEditableSelection(selection)) return;
      const isLatestTextCommit = bumpDomEditCommitVersion(domTextCommitVersionRef);
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let editedElement: HTMLElement | null = null;
      let previousInnerHtml: string | null = null;
      const content = document.createElement("div");
      content.innerHTML = value;
      sanitizeRichTextChildren(content);
      const richText = content.innerHTML;
      const operations: PatchOperation[] = [{ type: "rich-text", property: "innerHTML", value: richText }];

      await runDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, selection, activeCompPath);
          if (!el) return;
          editedElement = el;
          previousInnerHtml = el.innerHTML;
        },
        apply: () => {
          if (!editedElement) return;
          editedElement.innerHTML = richText;
        },
        persist: () =>
          queueDomEditSave(() =>
            persistDomEditOperations(selection, operations, {
              label: "Format text",
              skipRefresh: true,
              skipSdkCutover: true,
              shouldSave: isLatestTextCommit,
            }),
          ),
        shouldRevert: () => isLatestTextCommit(),
        revert: () => {
          if (!editedElement || previousInnerHtml === null) return;
          editedElement.innerHTML = previousInnerHtml;
        },
        onError: (error) => reportDomEditPersistFailure(selection, operations, error, showToast),
        shouldResync: isLatestTextCommit,
        resync: () =>
          resyncDomTextSelectionFromPreview(
            doc,
            selection,
            activeCompPath,
            buildDomSelectionFromTarget,
            applyDomSelection,
          ),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
      queueDomEditSave,
      showToast,
    ],
  );

  const commitDomTextFields = useCallback(
    async (
      selection: DomEditSelection,
      nextTextFields: DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null },
    ) => {
      const isLatestTextCommit = bumpDomEditCommitVersion(domTextCommitVersionRef);
      const textCommit = planDomTextCommit(
        selection.textFields,
        nextTextFields,
        nextTextFields[0]?.value ?? "",
      );
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let editedElement: HTMLElement | null = null;
      let revertPreview: (() => void) | null = null;
      const importedFont = options?.importedFont ?? null;

      await runDomEditCommit({
        capture: () => {
          if (!doc) return;
          const el = findElementForSelection(doc, selection, activeCompPath);
          if (!el) return;
          editedElement = el;
        },
        apply: () => {
          if (!editedElement) return;
          revertPreview = applyTextCommit(editedElement, textCommit);
        },
        persist: () =>
          queueDomEditSave(async () => {
            if (textCommit.usesSerializedTextFields && textCommit.childOperations === null) {
              throw new DomEditPersistUnsupportedTextStructureError();
            }
            await persistDomEditOperations(selection, textCommit.operations, {
              label: "Edit text",
              skipRefresh: true,
              skipSdkCutover: true,
              prepareContent: importedFont
                ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
                : undefined,
            });
          }),
        shouldRevert: () => isLatestTextCommit(),
        revert: () => {
          revertPreview?.();
        },
        onError: (error) =>
          reportDomEditPersistFailure(selection, textCommit.operations, error, showToast),
        shouldResync: isLatestTextCommit,
        resync: () =>
          resyncDomTextSelectionFromPreview(
            doc,
            selection,
            activeCompPath,
            buildDomSelectionFromTarget,
            applyDomSelection,
          ),
      });
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
      queueDomEditSave,
      showToast,
    ],
  );

  const handleDomTextFieldStyleCommit = useCallback(
    async (fieldKey: string, property: string, value: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      // Direct text nodes inherit their typography from the selected element;
      // serializing text fields would discard style-only edits such as font-size.
      if (textFieldStyleTargetsSelectedElement(field.source)) {
        await handleDomStyleCommit(property, value);
        return;
      }

      const normalizedValue = normalizeDomEditStyleValue(property, value);
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      if (property === "font-family") {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc) {
          injectPreviewGoogleFont(doc, normalizedValue);
          if (importedFont) injectPreviewImportedFont(doc, importedFont);
        }
      }
      const nextTextFields = domEditSelection.textFields.map((entry) => {
        if (entry.key !== fieldKey) return entry;
        const inlineStyles = { ...entry.inlineStyles };
        const computedStyles = { ...entry.computedStyles };
        if (normalizedValue === "") {
          delete inlineStyles[property];
          delete computedStyles[property];
        } else {
          inlineStyles[property] = normalizedValue;
          computedStyles[property] = normalizedValue;
        }
        return { ...entry, inlineStyles, computedStyles };
      });

      await commitDomTextFields(domEditSelection, nextTextFields, { importedFont });
    },
    [
      commitDomTextFields,
      domEditSelection,
      handleDomStyleCommit,
      resolveImportedFontAsset,
      previewIframeRef,
    ],
  );

  const handleDomAddTextField = useCallback(
    async (afterFieldKey?: string) => {
      if (!domEditSelection) return null;
      if (!domEditSelection.textFields.some((field) => field.source === "child")) return null;

      const insertionIndex = domEditSelection.textFields.findIndex(
        (field) => field.key === afterFieldKey,
      );
      const baseField =
        domEditSelection.textFields[insertionIndex >= 0 ? insertionIndex : 0] ??
        domEditSelection.textFields[0];
      const nextField = buildDefaultDomEditTextField(baseField);
      const nextTextFields = [...domEditSelection.textFields];
      nextTextFields.splice(
        insertionIndex >= 0 ? insertionIndex + 1 : nextTextFields.length,
        0,
        nextField,
      );

      await commitDomTextFields(domEditSelection, nextTextFields);
      return nextField.key;
    },
    [commitDomTextFields, domEditSelection],
  );

  const handleDomRemoveTextField = useCallback(
    async (fieldKey: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomTextCommit("", fieldKey);
        return;
      }

      const doc = previewIframeRef.current?.contentDocument;
      const parent = doc ? findElementForSelection(doc, domEditSelection, activeCompPath) : null;
      const textFieldElement = parent
        ? findDomTextFieldElement(parent, domEditSelection.textFields, fieldKey)
        : null;
      const textFieldSelection = textFieldElement
        ? await buildDomSelectionFromTarget(textFieldElement, { exactTarget: true })
        : null;
      if (!textFieldSelection) {
        showToast(`Couldn't locate "${field.value}" in the preview`, "error");
        return;
      }
      await removeDomTextFieldElement(textFieldSelection);
    },
    [
      activeCompPath,
      buildDomSelectionFromTarget,
      domEditSelection,
      handleDomTextCommit,
      previewIframeRef,
      removeDomTextFieldElement,
      showToast,
    ],
  );

  return {
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomTextCommit,
    handleDomInnerHtmlCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  };
}

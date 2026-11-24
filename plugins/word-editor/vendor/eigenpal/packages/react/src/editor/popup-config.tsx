import type { DocxEditorRevisionMarkupDialogProps } from './DocxEditorRevisionMarkupDialog';
import type { DocxEditorCompareDocumentsDialogProps } from './DocxEditorCompareDocumentsDialog';
import type { DocxEditorExportDialogProps } from './DocxEditorExportDialog';
import type { DocxEditorPrintDialogProps } from './DocxEditorPrintDialog';
import type { DocxEditorContentControlWidgetProps } from './DocxEditorContentControlWidget';
import type { DocxEditorInvalidTextFormFieldDialogProps } from './DocxEditorInvalidTextFormFieldDialog';
import type { DocxEditorImagePropertiesDialogProps } from './images/ImageProperties';
import type { DocxEditorImageAltTextPopupProps } from './images/ImageAltText';
import type { DocxEditorImageInsertErrorDialogProps } from './images/ImageInsertErrorDialog';
import type { DocxEditorNotePropertiesDialogProps } from './DocxEditorNotes';
import type {
  DocxEditorNotePreviewProps,
  DocxEditorNotesContextMenuProps,
} from './note-popup-parts';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { PopupConfigContext, usePopupConfig } from './popup-config-context';
import { renderPopup, type DocxEditorPopup } from './popup-renderer';
import type { DocxEditorPageSetupDialogProps } from './DocxEditorPageSetup';
import type { DocxEditorParagraphDialogProps } from './DocxEditorParagraphDialog';
import type { DocxEditorWatermarkDialogProps } from './DocxEditorWatermark';
import type { DocxEditorBookmarkDialogProps } from './DocxEditorBookmark';
import type { DocxEditorSplitCellDialogProps } from './DocxEditorSplitCell';
import type { DocxEditorTextFormFieldDialogProps } from './DocxEditorTextFormFieldDialog';
import { DocxEditorHyperLink, type HyperLinkProps } from './DocxEditorHyperLink';
import { DocxEditorContentControl, type ContentControlProps } from './DocxEditorContentControl';
import { DocxEditorEquation } from './DocxEditorEquation';
import { DocxEditorContextMenu, type DocxEditorContextMenuProps } from './contextmenu';

/** Render overrides for automatically mounted editor popups. `false` disables automatic rendering. @public */
export interface DocxEditorPopups {
  /** File export progress and errors. False hides feedback without stopping conversion. */
  export?: DocxEditorPopup<DocxEditorExportDialogProps>;
  /** File print progress and errors. False hides feedback; printing still runs. */
  print?: DocxEditorPopup<DocxEditorPrintDialogProps>;
  contentControlWidget?: DocxEditorPopup<DocxEditorContentControlWidgetProps>;
  /**
   * Renderer for checkbox presses. Omitted, the engine toggles the box itself and
   * `contentControlWidget` never sees a checkbox session. Configure it to confirm, refuse or
   * restyle the toggle; `DocxEditorContentControlWidget` without children applies it at once.
   */
  contentControlCheckbox?: DocxEditorPopup<DocxEditorContentControlWidgetProps>;
  /**
   * Renderer for picture presses. Omitted, the engine opens its own file picker and
   * `contentControlWidget` never sees a picture session. Configure it to pick from your own
   * source; `DocxEditorContentControlWidget` without children opens a file picker at once.
   */
  contentControlPicture?: DocxEditorPopup<DocxEditorContentControlWidgetProps>;
  invalidTextFormField?: DocxEditorPopup<DocxEditorInvalidTextFormFieldDialogProps>;
  /** Why a chosen or pasted picture could not be inserted. False shows nothing. */
  imageInsertError?: DocxEditorPopup<DocxEditorImageInsertErrorDialogProps>;
  imageProperties?: DocxEditorPopup<DocxEditorImagePropertiesDialogProps>;
  imageAltText?: DocxEditorPopup<DocxEditorImageAltTextPopupProps>;
  noteProperties?: DocxEditorPopup<DocxEditorNotePropertiesDialogProps>;
  notePreview?: DocxEditorPopup<DocxEditorNotePreviewProps>;
  notesContextMenu?: DocxEditorPopup<DocxEditorNotesContextMenuProps>;
  pageSetup?: DocxEditorPopup<DocxEditorPageSetupDialogProps>;
  paragraph?: DocxEditorPopup<DocxEditorParagraphDialogProps>;
  /** The Watermark dialog the Insert menu opens. Pass `presets` here to change its text choices. */
  watermark?: DocxEditorPopup<DocxEditorWatermarkDialogProps>;
  /** The Bookmark dialog the Insert menu and Ctrl/Cmd+Shift+F5 open. */
  bookmark?: DocxEditorPopup<DocxEditorBookmarkDialogProps>;
  /** The Split cells dialog the table context menu and toolbar open. */
  splitCell?: DocxEditorPopup<DocxEditorSplitCellDialogProps>;
  revisionMarkup?: DocxEditorPopup<DocxEditorRevisionMarkupDialogProps>;
  /** The Compare documents dialog the Review menu opens. Requires the review module. */
  compareDocuments?: DocxEditorPopup<DocxEditorCompareDocumentsDialogProps>;
  textFormField?: DocxEditorPopup<DocxEditorTextFormFieldDialogProps>;
  hyperlink?: DocxEditorPopup<HyperLinkProps>;
  contentControl?: DocxEditorPopup<ContentControlProps>;
  equation?: DocxEditorPopup<Record<string, never>>;
  contextMenu?: DocxEditorPopup<DocxEditorContextMenuProps>;
}

export const PopupConfigProvider = PopupConfigContext.Provider;
export { usePopupConfig };

/** Mounts only configured nonmodal surfaces; composed editors retain explicit ownership otherwise. */
export function ConfiguredPopups() {
  const popups = usePopupConfig();
  const { t } = useTranslation();
  return (
    <>
      {popups?.hyperlink && renderPopup(popups.hyperlink, {})}
      {popups?.contentControl && renderPopup(popups.contentControl, {})}
      {popups?.equation && renderPopup(popups.equation, {})}
      {popups?.contextMenu &&
        renderPopup(popups.contextMenu, { t: (key) => t(key as TranslationKey) })}
    </>
  );
}

/** The packaged editor fills defaults; an explicit popup entry wins over legacy shortcuts. */
export function createPackagedPopups(
  popups: DocxEditorPopups | undefined,
  hyperlinkPopup: boolean | undefined,
  contextMenu: boolean | DocxEditorContextMenuProps | undefined,
  t: DocxEditorContextMenuProps['t']
): DocxEditorPopups {
  return {
    ...popups,
    hyperlink:
      popups?.hyperlink ??
      (hyperlinkPopup === false ? false : (props) => <DocxEditorHyperLink {...props} />),
    contentControl: popups?.contentControl ?? ((props) => <DocxEditorContentControl {...props} />),
    equation: popups?.equation ?? (() => <DocxEditorEquation />),
    contextMenu:
      popups?.contextMenu !== undefined
        ? popups.contextMenu === false
          ? false
          : (props) =>
              popups.contextMenu && renderPopup(popups.contextMenu, { ...props, t: t ?? props.t })
        : contextMenu === false
          ? false
          : (props) => (
              <DocxEditorContextMenu
                {...props}
                t={t ?? props.t}
                {...(typeof contextMenu === 'object' ? contextMenu : {})}
              />
            ),
  };
}

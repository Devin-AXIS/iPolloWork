import { forwardRef, memo, useState } from 'react';
import { definePopup } from '../src/editor/popup-renderer';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import type { DocxEditorPageSetupDialogProps } from '../src/editor/DocxEditorPageSetup';

const Subset = (_props: { open: boolean }) => {
  const [draft] = useState('draft');
  return <span>{draft}</span>;
};
const Memoized = memo(Subset);
const Forwarded = forwardRef<HTMLDivElement, { open: boolean }>((_props, ref) => <div ref={ref} />);
const ExtraRequired = (_props: DocxEditorPageSetupDialogProps & { token: string }) => null;
const WrongType = (_props: { open: string }) => null;

// Included by the package typecheck, so unused expect-error directives fail CI.
export const supportedComponents: DocxEditorPopups[] = [
  { pageSetup: definePopup(Subset) },
  { pageSetup: definePopup(Memoized) },
  { pageSetup: definePopup(Forwarded) },
];
export const missingRequiredProp: DocxEditorPopups = {
  // @ts-expect-error The popup host does not provide a required token.
  pageSetup: definePopup(ExtraRequired),
};
export const incompatibleProp: DocxEditorPopups = {
  // @ts-expect-error The popup host provides boolean open, not string.
  pageSetup: definePopup(WrongType),
};

const RequiresOptionalHostProp = (_props: { open: boolean; className: string }) => null;
export const missingOptionalHostProp: DocxEditorPopups = {
  // @ts-expect-error The popup host can omit className.
  pageSetup: definePopup(RequiresOptionalHostProp),
};

import { DocxEditorExportDialog } from '../src/editor/DocxEditorExportDialog';
const WrongExportPending = (_props: { pending: string }) => null;
const NarrowExportFormat = (_props: { format: 'pdf' }) => null;
export const exportPopup: DocxEditorPopups = {
  export: definePopup(DocxEditorExportDialog),
};
export const wrongExportPending: DocxEditorPopups = {
  // @ts-expect-error Export progress uses a boolean.
  export: definePopup(WrongExportPending),
};
export const narrowExportFormat: DocxEditorPopups = {
  // @ts-expect-error Export popups must also accept Markdown.
  export: definePopup(NarrowExportFormat),
};

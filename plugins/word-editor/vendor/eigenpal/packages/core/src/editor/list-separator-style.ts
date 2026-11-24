import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import { ensureStyleDefinition } from '../store/package/style-definition-edit.ts';

/** Materialize Word's built-in only when Enter actually needs a blank list separator. */
export function ensureSeparatorStyle(
  defaultStyleId: string | null,
  styleId: string
): (pkg: OoxmlPackage) => OoxmlPackage {
  return ensureStyleDefinition(styleId, (element) =>
    element('style', { type: 'paragraph', styleId }, [
      element('name', { val: 'List Paragraph' }),
      ...(defaultStyleId ? [element('basedOn', { val: defaultStyleId })] : []),
      element('uiPriority', { val: '34' }),
      element('qFormat'),
      element('pPr', {}, [element('ind', { left: '720' }), element('contextualSpacing')]),
    ])
  );
}

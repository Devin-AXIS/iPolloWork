import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  APPLICATION_PARAGRAPH_PROPERTIES,
  omittedDocDefaults,
} from '../store/package/application-doc-defaults.ts';

/**
 * An omitted pPrDefault is application-defined (17.7.5.4), unlike an explicitly empty
 * pPrDefault (`application-doc-defaults.ts`). Authored properties in any later cascade layer
 * override these independently, including explicit zero. This is layout material only; the
 * source styles part remains untouched.
 */
export function applicationParagraphDefaults(
  styles: OoxmlElement | null
): readonly OoxmlProperty[] {
  return omittedDocDefaults(styles).paragraph ? APPLICATION_PARAGRAPH_PROPERTIES : [];
}

// Document-property fields change measured text without changing their paragraph nodes.
import { withFieldResultsProducer } from './field-results-producer.ts';
import type { DocumentProperties } from '@docx-editor.dev/core/store';
import type { DocumentPropertyKey } from './field-doc-property.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import { producerWithControlContext } from './pass-producer.ts';

const FIELD_PROPERTY_SET = {
  title: true,
  creator: true,
  subject: true,
  keywords: true,
  lastModifiedBy: true,
  description: true,
} satisfies Readonly<Record<DocumentPropertyKey, true>>;
const FIELD_PROPERTIES = Object.keys(FIELD_PROPERTY_SET) as DocumentPropertyKey[];
interface PropertyContext {
  readonly values: readonly string[];
  readonly token: string;
}
const contexts = new WeakMap<DocumentProperties, PropertyContext>();

/** Invalidate field measurements when any supported property value changes. */
function producerWithDocumentProperties(
  base: string | undefined,
  properties: DocumentProperties | undefined
): string | undefined {
  if (!properties) return base;
  let context = contexts.get(properties);
  if (
    !context ||
    FIELD_PROPERTIES.some((key, i) => (properties[key] ?? '') !== context!.values[i])
  ) {
    const values = FIELD_PROPERTIES.map((key) => properties[key] ?? '');
    context = {
      values,
      token: values.some(Boolean) ? `document-properties:${JSON.stringify(values)}` : '',
    };
    contexts.set(properties, context);
  }
  return context.token === '' ? base : producerWithControlContext(base, context.token);
}

/** Compose document-wide field and control inputs before section measurements. */
export function documentProjectionProducer(
  options: Pick<
    SemanticLayoutOptions,
    | 'producer'
    | 'showFieldCodes'
    | 'documentProperties'
    | 'projectionEpoch'
    | 'projectionTokenForParagraph'
  >,
  controlToken: string,
  tocToken: string
): string {
  const shown = options.showFieldCodes ? `${options.producer ?? ''}|field-codes` : options.producer;
  const base = shown === undefined ? shown : withFieldResultsProducer(shown);
  // Coordinated hosts already invalidate only paragraphs whose projected values changed.
  // A partial projection contract must retain the document-wide fallback.
  const properties =
    options.projectionEpoch !== undefined && options.projectionTokenForParagraph
      ? undefined
      : options.documentProperties;
  return producerWithControlContext(
    producerWithControlContext(producerWithDocumentProperties(base, properties), controlToken),
    tocToken
  );
}

// Legacy default-paragraph size/alignment exceptions inside tables. The
// `strictTableStyleHierarchy` compatibility rule (`overrideTableStyleFontSizeAndJustification`,
// on by default in compatibility mode 15 and later) turns them off.
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

/** The table style material {@link tableStyleStatesTypography} reads. */
export interface TableStyleTypographySource {
  readonly paragraphProperties: readonly OoxmlProperty[];
  readonly runProperties: readonly OoxmlProperty[];
  readonly conditional: ReadonlyMap<string, OoxmlElement>;
}

const isChangeRecord = (localName: string) =>
  localName === 'pPrChange' || localName === 'rPrChange';

function statesProperties(properties: readonly OoxmlProperty[]): boolean {
  return properties.some((property) => !isChangeRecord(property.localName));
}

function conditionStatesProperties(format: OoxmlElement): boolean {
  return format.children.some(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      (child.localName === 'pPr' || child.localName === 'rPr') &&
      child.children.some(
        (property) =>
          property.kind !== 'textValue' &&
          property.namespaceUri === WML_NAMESPACE_URI &&
          !isChangeRecord(property.localName)
      )
  );
}

const statedTypography = new WeakMap<TableStyleTypographySource, boolean>();

/**
 * Whether a table style states paragraph or run formatting: a non-empty `w:pPr` or `w:rPr`
 * (17.7.6) on the style or its `w:basedOn` chain, or in a conditional format (17.7.6.6). The
 * statement is about the whole style, so a header row condition counts for every row. Table,
 * row, and cell properties do not count, and neither do empty elements or a `wholeTable`
 * condition.
 */
export function tableStyleStatesTypography(formatting: TableStyleTypographySource): boolean {
  const cached = statedTypography.get(formatting);
  if (cached !== undefined) return cached;
  let states =
    statesProperties(formatting.paragraphProperties) || statesProperties(formatting.runProperties);
  for (const [condition, format] of formatting.conditional) {
    if (states) break;
    states = condition !== 'wholeTable' && conditionStatesProperties(format);
  }
  statedTypography.set(formatting, states);
  return states;
}

/**
 * Only the default paragraph style is filtered, never derived styles or direct formatting.
 *
 * A default-style 11pt or 12pt size yields when the table style states any paragraph or run
 * formatting (`statesTypography`, see {@link tableStyleStatesTypography}): the cell then takes
 * the table style's size, or the document default size when the style states none. A table
 * style that states no paragraph or run formatting keeps the default paragraph style's size.
 * `tableRun` is the table style's run material for the cell; a size there always counts. A
 * default-style left alignment always yields to the table style.
 */
export function legacyTableDefaultProperties(
  properties: readonly OoxmlProperty[],
  tableRun: readonly OoxmlProperty[],
  statesTypography = false
): readonly OoxmlProperty[] {
  const values = new Map<string, string | undefined>();
  for (const property of properties) values.set(property.localName, property.attributes?.val);
  const ignored = new Set<string>();
  for (const name of ['sz', 'szCs']) {
    const value = Number(values.get(name));
    if (
      (value === 22 || value === 24) &&
      (statesTypography ||
        tableRun.some(
          (property) => property.localName === name && Number(property.attributes?.val) > 0
        ))
    )
      ignored.add(name);
  }
  if (values.get('jc') === 'left') ignored.add('jc');
  return ignored.size
    ? properties.filter((property) => !ignored.has(property.localName))
    : properties;
}

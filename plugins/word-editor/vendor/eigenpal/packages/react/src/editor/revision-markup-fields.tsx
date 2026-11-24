import { REVISION_MARKUP_COLORS, type ResolvedRevisionMarkup } from '@docx-editor.dev/core/editor';
import type { UseRevisionMarkupDialogReturn } from './DocxEditorRevisionMarkupDialog';
import { RevisionMarkupColorPicker as ColorPicker } from './revision-markup-color-picker';

const marks = [
  'none',
  'colorOnly',
  'bold',
  'italic',
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
];
const colors = ['byAuthor', 'auto', ...REVISION_MARKUP_COLORS];
/** Builds marked defaults so generic dialog parts can replace each settings group. */
export function revisionMarkupFields(
  state: UseRevisionMarkupDialogReturn,
  t: (key: string) => string,
  noteId: string
) {
  const { values } = state;
  const row = (
    name: 'insertions' | 'deletions' | 'changedLines' | 'movedFrom' | 'movedTo' | 'formatting'
  ) => {
    const available =
      name === 'changedLines'
        ? ['none', 'leftBorder', 'rightBorder', 'outsideBorder']
        : name === 'deletions' || name === 'movedFrom'
          ? [...marks, 'hidden', 'caret', 'pound']
          : marks;
    const disabled = (name === 'movedFrom' || name === 'movedTo') && !values.trackMoves;
    return (
      <div data-docx-part="field" data-docx-field={name}>
        <div className="docx-revision-markup-row">
          <span className="docx-revision-markup-row-title" aria-hidden="true">
            {t(name)}
          </span>
          <label>
            <span className="docx-revision-markup-field-label">{t(name)}</span>
            <select
              value={values[name].mark}
              disabled={disabled}
              onChange={(event) =>
                state.setValue(name, {
                  ...values[name],
                  mark: event.target.value,
                } as ResolvedRevisionMarkup[typeof name])
              }
            >
              {available.map((mark) => (
                <option key={mark} value={mark}>
                  {t(`values.${mark}`)}
                </option>
              ))}
            </select>
          </label>
          <ColorPicker
            label={t(`${name}Color`)}
            value={values[name].color}
            values={colors}
            disabled={disabled}
            t={t}
            change={(color) =>
              state.setValue(name, {
                ...values[name],
                color,
              } as ResolvedRevisionMarkup[typeof name])
            }
          />
        </div>
        {name !== 'changedLines' && (
          <div className="docx-revision-markup-background">
            <ColorPicker
              label={t(`${name}Background`)}
              value={values[name].background}
              values={['none', 'byAuthor', ...REVISION_MARKUP_COLORS]}
              disabled={disabled}
              t={t}
              change={(background) =>
                state.setValue(name, {
                  ...values[name],
                  background,
                } as ResolvedRevisionMarkup[typeof name])
              }
            />
          </div>
        )}
      </div>
    );
  };
  const checkbox = (name: 'trackMoves' | 'trackFormatting') => (
    <div data-docx-part="field" data-docx-field={name}>
      <label>
        <input
          type="checkbox"
          checked={values[name]}
          aria-describedby={`${noteId}-${name}`}
          onChange={(event) => state.setValue(name, event.target.checked)}
        />
        {t(name)}
      </label>
      <p id={`${noteId}-${name}`}>{t(`${name}Note`)}</p>
    </div>
  );
  return (
    <>
      <fieldset>
        <legend>{t('markup')}</legend>
        {row('insertions')}
        {row('deletions')}
        {row('changedLines')}
      </fieldset>
      <fieldset>
        <legend>{t('moves')}</legend>
        {checkbox('trackMoves')}
        {row('movedFrom')}
        {row('movedTo')}
      </fieldset>
      <fieldset
        data-docx-part="field"
        data-docx-field="cells"
        className="docx-revision-markup-tableCells"
      >
        <legend>{t('tableCells')}</legend>
        {(['inserted', 'deleted', 'merged', 'split'] as const).map((name) => (
          <ColorPicker
            key={name}
            label={t(`${name}Cells`)}
            value={values.cells[name]}
            values={['byAuthor', 'none', ...REVISION_MARKUP_COLORS]}
            t={t}
            change={(color) =>
              state.setValue('cells', {
                ...values.cells,
                [name]: color,
              } as ResolvedRevisionMarkup['cells'])
            }
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('formatting')}</legend>
        {checkbox('trackFormatting')}
        {row('formatting')}
      </fieldset>
    </>
  );
}

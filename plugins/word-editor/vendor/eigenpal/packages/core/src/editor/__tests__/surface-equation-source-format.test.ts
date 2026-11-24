import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createEquationOps, type EquationOpsDeps } from '../surface-equations.ts';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const run = (properties = '') => `<m:r>${properties}<m:t>Q</m:t></m:r>`;
const DEFAULT_FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';
const DEFAULT = `${DEFAULT_FONT}<w:i/>`;
const FULL_RUN =
  `${DEFAULT_FONT}<w:i/><w:sz w:val="24"/><w:szCs w:val="24"/>` + '<w:lang w:val="en-US"/>';
const fraction = (properties: string | null) =>
  `<m:f><m:fPr><m:ctrlPr>${properties === null ? '' : `<w:rPr>${properties}</w:rPr>`}` +
  `</m:ctrlPr></m:fPr><m:num>${run()}</m:num><m:den>${run()}</m:den></m:f>`;
const cases = [
  ['plain', run(), false],
  ['font', run('<w:rPr><w:rFonts w:ascii="Public Math" w:hAnsi="Public Math"/></w:rPr>'), true],
  [
    'font slots that name different faces',
    run(
      '<w:rPr><w:rFonts w:ascii="Public Text" w:hAnsi="Public Text" w:eastAsia="Public East" ' +
        'w:cs="Public Complex"/><w:sz w:val="36"/></w:rPr>'
    ),
    true,
  ],
  [
    'control font slots that name different faces',
    fraction(
      '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="Public East"/><w:i/>'
    ),
    true,
  ],
  ['literal', run('<m:rPr><m:lit/></m:rPr>'), true],
  ['normal', run('<m:rPr><m:nor/></m:rPr>'), true],
  ['bar', `<m:bar><m:e>${run()}</m:e></m:bar>`, true],
  ['delimiter', `<m:d><m:e>${run()}</m:e></m:d>`, true],
  ['bold fraction control properties', fraction('<w:b/>'), true],
  ['default fraction control properties', fraction(DEFAULT), false],
  [
    'full default control properties',
    fraction(
      DEFAULT_FONT +
        '<w:i w:val="1"/><w:iCs/><w:sz w:val="24"/><w:szCs w:val="24"/>' +
        '<w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/>'
    ),
    false,
  ],
  ['empty control properties', fraction(null), false],
  [
    'tracked default control properties',
    `<m:f><m:fPr><m:ctrlPr><w:ins w:id="1" w:author="Public Author"><w:rPr>${DEFAULT}</w:rPr>` +
      `</w:ins></m:ctrlPr></m:fPr><m:num>${run()}</m:num><m:den>${run()}</m:den></m:f>`,
    true,
  ],
  ['other control font', fraction('<w:rFonts w:ascii="Public Math"/><w:i/>'), true],
  ['italic off', fraction('<w:i w:val="0"/>'), true],
  // A complex-script size applies to no control character, but it is not default.
  ['unequal control sizes', fraction('<w:sz w:val="24"/><w:szCs w:val="28"/>'), true],
  ['default beside bold control properties', fraction(DEFAULT) + fraction('<w:b/>'), true],
  [
    'sizes that differ between structures',
    fraction('<w:sz w:val="24"/>') + fraction('<w:sz w:val="28"/>'),
    true,
  ],
  [
    'nested tracked control properties',
    `<m:sSup><m:e><m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr>` +
      `<w:ins w:id="1" w:author="Public Author"><w:rPr><w:b/></w:rPr></w:ins>` +
      `</m:ctrlPr></m:radPr><m:deg/><m:e>${run()}</m:e></m:rad></m:e><m:sup>${run()}</m:sup></m:sSup>`,
    true,
  ],
  ['default run properties', run(`<w:rPr>${DEFAULT}</w:rPr>`), false],
  [
    'full default run properties with default controls',
    `<m:f><m:fPr><m:ctrlPr><w:rPr>${DEFAULT}</w:rPr></m:ctrlPr></m:fPr>` +
      `<m:num>${run(`<w:rPr>${FULL_RUN}</w:rPr>`)}</m:num>` +
      `<m:den>${run(`<w:rPr>${FULL_RUN}</w:rPr>`)}</m:den></m:f>`,
    false,
  ],
  ['a bare run beside default run properties', run() + run(`<w:rPr>${DEFAULT}</w:rPr>`), true],
  [
    'italic on only some runs',
    run(`<w:rPr>${DEFAULT}</w:rPr>`) + run(`<w:rPr>${DEFAULT_FONT}</w:rPr>`),
    true,
  ],
  [
    'run properties with different sizes',
    run(`<w:rPr>${DEFAULT_FONT}<w:sz w:val="24"/></w:rPr>`) +
      run(`<w:rPr>${DEFAULT_FONT}<w:sz w:val="28"/></w:rPr>`),
    true,
  ],
  [
    'run properties with different languages',
    run('<w:rPr><w:lang w:val="en-US"/></w:rPr>') + run('<w:rPr><w:lang w:val="pl-PL"/></w:rPr>'),
    true,
  ],
  [
    'default run properties with a math style',
    run(`<m:rPr><m:sty m:val="p"/></m:rPr><w:rPr>${DEFAULT}</w:rPr>`),
    true,
  ],
  ['unknown', '<m:unknown/>', false],
] as const;

for (const [name, body, protectedSource] of cases) {
  test(`compact replacement preserves ${name} source before tree writes`, () => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${WORD}" xmlns:m="${MATH}"><w:body><w:p>` +
        `<w:r><w:t xml:space="preserve">Left </w:t></w:r><m:oMath>${body}</m:oMath>` +
        '<w:r><w:t xml:space="preserve"> right</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error('Public canonical fixture did not parse');
    const paragraph = parsed.part.root.children
      .find((node) => node.kind === 'body')
      ?.children.find((node) => node.kind === 'paragraph');
    if (!paragraph) throw new Error('Missing public paragraph');
    const before = serializeOoxmlPart(parsed.part);
    const position = { paragraphId: paragraph.id, offset: 5 };
    let writes = 0;
    let writeRefusals = 0;
    let mode: 'edit' | 'suggest' | 'view' = 'edit';
    const commits: unknown[] = [];
    const session = {
      partFor: () => parsed.part,
      storyParts: () => [parsed.part],
      applyTreeOps: () => {
        writes++;
        return { committed: true };
      },
    } as unknown as EquationOpsDeps['session'];
    const ops = createEquationOps({
      session,
      storyScope: () => ({ kind: 'body' }),
      editingMode: () => mode,
      writeRefusal: () => {
        writeRefusals++;
        return null;
      },
      trackedOps: (ops) => [...ops],
      selection: () => ({ anchor: position, head: position }),
      selectionMark: () => null,
      commit: (execute) => {
        commits.push(execute());
      },
    });
    const equation = ops.equationsInCaretParagraph()[0];
    if (!equation) throw new Error('Missing real canonical equation');
    expect(ops.can(equation.id, 'replace').ok).toBe(!protectedSource);
    expect(ops.applyEquation(equation.id, 'R')).toBe(!protectedSource);
    expect(writes).toBe(protectedSource ? 0 : 1);
    if (protectedSource) {
      expect(writeRefusals).toBe(0);
      expect(commits).toEqual([
        {
          committed: false,
          rejected: true,
          opCount: 0,
          reason: 'compact linear editing cannot preserve this equation source formatting',
        },
      ]);
    }
    expect(ops.can(equation.id, 'remove').ok).toBe(true);
    mode = 'suggest';
    expect(ops.can(equation.id, 'replace').ok).toBe(false);
    // A removal is a tracked deletion of the equation in suggesting mode.
    expect(ops.can(equation.id, 'remove').ok).toBe(true);
    expect(serializeOoxmlPart(parsed.part)).toEqual(before);
  });
}

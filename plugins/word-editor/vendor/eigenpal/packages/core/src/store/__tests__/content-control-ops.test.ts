// Content controls are written through the canonical op path, and only through it.
//
// One transaction per gesture, one refusal vocabulary for every caller: a value that does not
// belong to a dropdown, a control a template locked, a control bound to custom XML, and a
// control whose type does not match the value offered all answer a named rejection instead of
// a partial write.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  paragraphOffsetIndex,
  readOoxmlPart,
  serializeOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { applySetContentControlValue } from '../store/tree-op-content-controls.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from '../store/tree-op-types.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { segmentsOf } from '../store/tree-op-validate.ts';
import {
  findContentControl,
  hasGlossaryPlaceholderRef,
  isShowingPlaceholder,
  normalizeSdtFullDate,
} from '../store/tree-op-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function controlIds(part: OoxmlPart): string[] {
  return contentControlsIn(part.root).map((entry) => entry.node.id);
}

function controlOf(part: OoxmlPart, index = 0): OoxmlNode {
  const found = contentControlsIn(part.root)[index];
  if (!found) throw new Error('no control');
  return found.node;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

const PLAIN_TEXT = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="name"/><w:text/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const DROPDOWN = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="pick"/><w:dropDownList>` +
    `<w:listItem w:displayText="Choose one" w:value="none"/>` +
    `<w:listItem w:displayText="Yes, please" w:value="yes"/></w:dropDownList></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>Choose one</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const CHECKBOX = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="agree"/>` +
    `<w14:checkbox><w14:checked w14:val="0"/>` +
    `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
    `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>\u2610</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const DATE = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="when"/>` +
    `<w:date w:fullDate="2020-01-02T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/>` +
    `<w:lid w:val="en-US"/></w:date></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>2020-01-02</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

describe('setContentControlValue writes the value each type accepts', () => {
  test('a plain-text control takes a string and keeps its run formatting', () => {
    const id = controlIds(PLAIN_TEXT)[0]!;
    const next = apply(PLAIN_TEXT, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'text', text: 'Ada' },
    });
    const control = controlOf(next);
    expect(contentControlTextOf(control)).toBe('Ada');
    // The control's own character formatting survives a value write.
    expect(serializeOoxmlPart(next)).toContain('<w:b/>');
  });

  test('a dropdown accepts a declared item and records it as the last value', () => {
    const id = controlIds(DROPDOWN)[0]!;
    const next = apply(DROPDOWN, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'listItem', value: 'yes' },
    });
    expect(contentControlTextOf(controlOf(next))).toBe('Yes, please');
    expect(contentControlPropertiesOf(controlOf(next)).lastValue).toBe('yes');
  });

  test('a dropdown refuses a value it does not declare', () => {
    const id = controlIds(DROPDOWN)[0]!;
    expect(
      refusal(DROPDOWN, {
        op: 'setContentControlValue',
        controlId: id,
        value: { kind: 'listItem', value: 'maybe' },
      })
    ).toBe('invalidArgs');
  });

  test('a combo box accepts free text a dropdown would refuse', () => {
    const combo = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:comboBox>` +
        `<w:listItem w:displayText="One" w:value="1"/></w:comboBox></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const id = controlIds(combo)[0]!;
    const next = apply(combo, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'text', text: 'something else' },
    });
    expect(contentControlTextOf(controlOf(next))).toBe('something else');
  });

  test('a checkbox writes the declared glyph and the checked flag together', () => {
    const id = controlIds(CHECKBOX)[0]!;
    const next = apply(CHECKBOX, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'checkbox', checked: true },
    });
    expect(contentControlPropertiesOf(controlOf(next)).checkbox?.checked).toBe(true);
    expect(serializeOoxmlPart(next)).toContain('<w:sym w:char="2612" w:font="MS Gothic"/>');
  });

  test('a date validates ISO input and writes fullDate beside the formatted content', () => {
    const id = controlIds(DATE)[0]!;
    const next = apply(DATE, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'date', iso: '2024-03-09' },
    });
    expect(contentControlPropertiesOf(controlOf(next)).date?.fullDate).toBe('2024-03-09T00:00:00Z');
    expect(contentControlTextOf(controlOf(next))).toBe('2024-03-09');
    expect(
      refusal(DATE, {
        op: 'setContentControlValue',
        controlId: id,
        value: { kind: 'date', iso: 'the ninth of March' },
      })
    ).toBe('invalidArgs');
  });

  test('normalizeSdtFullDate enforces the xsd:dateTime ±14:00 timezone bound', () => {
    expect(normalizeSdtFullDate('2026-01-01T00:00:00+14:00')).toBe('2026-01-01T00:00:00+14:00');
    expect(normalizeSdtFullDate('2026-01-01T00:00:00-14:00')).toBe('2026-01-01T00:00:00-14:00');
    expect(normalizeSdtFullDate('2026-01-01T00:00:00+13:59')).toBe('2026-01-01T00:00:00+13:59');
    expect(normalizeSdtFullDate('2026-01-01T00:00:00+15:00')).toBeNull();
    expect(normalizeSdtFullDate('2026-01-01T00:00:00+14:01')).toBeNull();
    expect(normalizeSdtFullDate('2026-01-01T00:00:00-15:00')).toBeNull();
  });

  test('a value of the wrong shape for the control is a type mismatch', () => {
    expect(
      refusal(CHECKBOX, {
        op: 'setContentControlValue',
        controlId: controlIds(CHECKBOX)[0]!,
        value: { kind: 'text', text: 'yes' },
      })
    ).toBe('typeMismatch');
    expect(
      refusal(PLAIN_TEXT, {
        op: 'setContentControlValue',
        controlId: controlIds(PLAIN_TEXT)[0]!,
        value: { kind: 'checkbox', checked: true },
      })
    ).toBe('typeMismatch');
  });

  test('a control the file bound to custom XML refuses the write and keeps the binding', () => {
    const bound = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:dataBinding w:xpath="/root/name" w:storeItemID="{ABC}"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>bound</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(
      refusal(bound, {
        op: 'setContentControlValue',
        controlId: controlIds(bound)[0]!,
        value: { kind: 'text', text: 'other' },
      })
    ).toBe('bound');
    expect(serializeOoxmlPart(bound)).toContain('w:storeItemID="{ABC}"');
  });

  test('an unknown control id is refused rather than ignored', () => {
    expect(
      refusal(PLAIN_TEXT, {
        op: 'setContentControlValue',
        controlId: 'no-such-node',
        value: { kind: 'text', text: 'x' },
      })
    ).toBe('unknown-content-control');
  });
});

// The op carries `string | ContentControlValueInput`. The editor-facing form is a bare string,
// whose characters mean whatever the control's own type says they mean, and the structured form
// states the kind instead of implying it. They must be ONE definition of what a value is: a
// string read as text for a dropdown would write a caption the list never declared.
describe('a bare string is read in the vocabulary the control type declares', () => {
  function write(part: OoxmlPart, value: string): TreeOpResult {
    return applySetContentControlValue(part, {
      op: 'setContentControlValue',
      controlId: controlIds(part)[0]!,
      value,
    });
  }

  function written(part: OoxmlPart, value: string): OoxmlPart {
    const result = write(part, value);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.part;
  }

  function rejected(part: OoxmlPart, value: string): TreeOpRejection | null {
    const result = write(part, value);
    return result.ok ? null : result.reason;
  }

  test('a dropdown reads it as one of its own item values', () => {
    const next = written(DROPDOWN, 'yes');
    expect(contentControlTextOf(controlOf(next))).toBe('Yes, please');
    expect(contentControlPropertiesOf(controlOf(next)).lastValue).toBe('yes');
  });

  test('a dropdown still refuses an item it does not declare', () => {
    expect(rejected(DROPDOWN, 'maybe')).toBe('invalidArgs');
  });

  test('a checkbox reads it as a state and writes the declared glyph', () => {
    const next = written(CHECKBOX, 'true');
    expect(contentControlPropertiesOf(controlOf(next)).checkbox?.checked).toBe(true);
    expect(serializeOoxmlPart(next)).toContain('<w:sym w:char="2612" w:font="MS Gothic"/>');
  });

  test('a string that is neither state is a type mismatch, not an unchecked box', () => {
    expect(rejected(CHECKBOX, 'perhaps')).toBe('typeMismatch');
  });

  test('a date reads it as ISO input', () => {
    const next = written(DATE, '2024-03-09');
    expect(contentControlPropertiesOf(controlOf(next)).date?.fullDate).toBe('2024-03-09T00:00:00Z');
  });

  test('every other type reads it as the text it is', () => {
    expect(contentControlTextOf(controlOf(written(PLAIN_TEXT, 'Ada')))).toBe('Ada');
  });
});

describe('placeholder and temporary state are transitions, not text', () => {
  const PROMPT = parseDoc(
    `<w:p><w:sdt><w:sdtPr><w:tag w:val="prompt"/><w:showingPlcHdr/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>Click here to enter text.</w:t></w:r></w:sdtContent></w:sdt></w:p>`
  );

  test('the first value write replaces the whole prompt and clears the flag', () => {
    const next = apply(PROMPT, {
      op: 'setContentControlValue',
      controlId: controlIds(PROMPT)[0]!,
      value: { kind: 'text', text: 'A' },
    });
    const properties = contentControlPropertiesOf(controlOf(next));
    expect(properties.showingPlaceholder).toBe(false);
    expect(contentControlTextOf(controlOf(next))).toBe('A');
    expect(serializeOoxmlPart(next)).not.toContain('showingPlcHdr');
  });

  test('a block placeholder replace keeps the prompt paragraph and reports it dirty', () => {
    // A BLOCK control's prompt lives in its own paragraph. The replace keeps that paragraph,
    // with its properties, and swaps its runs, so paragraph-keyed caches (the retained review
    // order index) hear about it through `dirty`; a paragraph that does go is reported deleted
    // and a minted one created, so the paragraph set is never silently wrong.
    const block = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="blockPrompt"/><w:showingPlcHdr/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:pPr><w:pStyle w:val="Prompt"/></w:pPr><w:r><w:t>Click here to enter text.</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Second prompt line.</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const [promptParagraph, secondParagraph] = paragraphs(block);
    const result = applyTreeOp(block, {
      op: 'insertHardBreak',
      paragraphId: promptParagraph!.id,
      offset: 0,
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const after = paragraphs(result.part);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(promptParagraph!.id);
    expect(serializeOoxmlPart(result.part)).toContain('<w:pStyle w:val="Prompt"/>');
    expect(result.effect.dirty).toContain(promptParagraph!.id);
    expect(result.effect.deleted).toEqual([secondParagraph!.id]);
    expect(result.effect.created).toEqual([]);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('an inline placeholder replace stays text-local with the paragraph intact', () => {
    const paragraph = paragraphs(PROMPT)[0]!;
    const result = applyTreeOp(PROMPT, {
      op: 'insertHardBreak',
      paragraphId: paragraph.id,
      offset: 0,
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(paragraphs(result.part)[0]!.id).toBe(paragraph.id);
    expect(result.effect.created).toEqual([]);
    expect(result.effect.deleted).toEqual([]);
    expect(result.effect.impact).toBe('text-local');
  });

  test('typing into the prompt through an ordinary text op replaces it too', () => {
    const paragraph = paragraphs(PROMPT)[0]!;
    const next = apply(PROMPT, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 0,
      text: 'A',
    });
    // Word does not leave "AClick here to enter text." behind: the prompt is state, and the
    // first character the user types is the control's whole content.
    expect(contentControlTextOf(controlOf(next))).toBe('A');
    expect(contentControlPropertiesOf(controlOf(next)).showingPlaceholder).toBe(false);
  });

  test('emptying the control restores the prompt and the flag', () => {
    const typed = apply(PROMPT, {
      op: 'setContentControlValue',
      controlId: controlIds(PROMPT)[0]!,
      value: { kind: 'text', text: 'A' },
    });
    const cleared = apply(typed, {
      op: 'setContentControlValue',
      controlId: controlIds(typed)[0]!,
      value: { kind: 'text', text: '' },
    });
    const properties = contentControlPropertiesOf(controlOf(cleared));
    expect(properties.showingPlaceholder).toBe(true);
    expect(contentControlTextOf(controlOf(cleared))).toBe('Click here to enter text.');
  });

  test('a temporary control removes its wrapper on the first content edit, keeping content', () => {
    const temporary = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="once"/><w:temporary/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>old</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const next = apply(temporary, {
      op: 'setContentControlValue',
      controlId: controlIds(temporary)[0]!,
      value: { kind: 'text', text: 'new' },
    });
    expect(contentControlsIn(next.root)).toHaveLength(0);
    expect(serializeOoxmlPart(next)).toContain('new');
  });

  test('a glossary reference is preserved and never resolved', () => {
    const glossary = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:placeholder><w:docPart w:val="DefaultPlaceholder_1"/></w:placeholder>` +
        `<w:showingPlcHdr/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>Enter a name</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(contentControlPropertiesOf(controlOf(glossary)).placeholderDocPart).toBe(
      'DefaultPlaceholder_1'
    );
    const next = apply(glossary, {
      op: 'setContentControlValue',
      controlId: controlIds(glossary)[0]!,
      value: { kind: 'text', text: 'Ada' },
    });
    // The reference stays; the engine never reads the glossary part it names.
    expect(serializeOoxmlPart(next)).toContain('DefaultPlaceholder_1');
  });
});

// D9: a value edit is the only thing the file records. The digest is taken from the saved bytes
// and reopened bytes, so a difference here is a difference a consumer's Word would see, not an
// in-memory tree shape; every control the edit did not name must compare equal across it.
describe('a value edit survives save and reopen, and touches nothing else', () => {
  const THREE = parseDoc(
    `<w:p><w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="1"/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="two"/><w:id w:val="2"/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
      `<w:sdt><w:sdtPr><w:tag w:val="three"/><w:id w:val="3"/><w:dropDownList>` +
      `<w:listItem w:displayText="Yes" w:value="yes"/></w:dropDownList></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>Yes</w:t></w:r></w:p></w:sdtContent></w:sdt>`
  );

  test('the edited control reads its new value and the others are unchanged', () => {
    const before = contentControlsIn(THREE.root).map((entry) => entry.node.id);
    const edited = apply(THREE, {
      op: 'setContentControlValue',
      controlId: before[1]!,
      value: { kind: 'text', text: 'written' },
    });
    const reopened = readOoxmlPart(serializeOoxmlPart(edited), docMeta);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.reason);
    const texts = contentControlsIn(reopened.part.root).map((entry) =>
      contentControlTextOf(entry.node)
    );
    expect(texts).toEqual(['first', 'written', 'Yes']);
    const tags = contentControlsIn(reopened.part.root).map(
      (entry) => contentControlPropertiesOf(entry.node).tag
    );
    expect(tags).toEqual(['one', 'two', 'three']);
  });

  test('the semantic digest of the saved file differs only where the edit was', () => {
    const controls = contentControlsIn(THREE.root);
    const edited = apply(THREE, {
      op: 'setContentControlValue',
      controlId: controls[1]!.node.id,
      value: { kind: 'text', text: 'written' },
    });
    const reopen = (part: OoxmlPart): OoxmlPart => {
      const result = readOoxmlPart(serializeOoxmlPart(part), docMeta);
      if (!result.ok) throw new Error(result.reason);
      return result.part;
    };
    const differences = diffSemanticDigests(
      semanticDigest([reopen(THREE)]),
      semanticDigest([reopen(edited)])
    );
    // ONE difference, at the text of the one paragraph the write landed in. The controls either
    // side of it, their properties and the structure holding them all compare equal.
    expect(differences).toEqual([
      { path: '/word/document.xml.p[1].text', before: '"second"', after: '"written"' },
    ]);
    // And an unedited save is identical by digest, so the difference above is the edit.
    expect(
      diffSemanticDigests(semanticDigest([reopen(THREE)]), semanticDigest([reopen(reopen(THREE))]))
    ).toEqual([]);
  });

  // The oracle's whole job. Typing `w:sdt` moved an inline control's runs from a subtree
  // fingerprint onto a walk that digests properties and drops text, which would have made a
  // save that emptied a form field indistinguishable from one that kept its value.
  test('a control that lost its content is a reported loss, not a silent one', () => {
    const emptied = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="1"/><w:text/></w:sdtPr>` +
        `<w:sdtContent/></w:sdt></w:p>` +
        `<w:p><w:sdt><w:sdtPr><w:tag w:val="two"/><w:id w:val="2"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="three"/><w:id w:val="3"/><w:dropDownList>` +
        `<w:listItem w:displayText="Yes" w:value="yes"/></w:dropDownList></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>Yes</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(
      diffSemanticDigests(semanticDigest([THREE]), semanticDigest([emptied])).map(
        (difference) => difference.path
      )
    ).toEqual(['/word/document.xml.p[0].text', '/word/document.xml.p[0].runProperties']);
  });

  // A tag, a lock or a type is the control's identity, and none of them is text.
  test('a control that lost its tag is a reported loss too', () => {
    const untagged = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:id w:val="1"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const tagged = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="1"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(diffSemanticDigests(semanticDigest([tagged]), semanticDigest([untagged]))).not.toEqual(
      []
    );
  });
});

describe('metadata, insertion and removal', () => {
  test('setContentControlProperties writes in schema order and leaves the rest alone', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:id w:val="5"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>v</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const next = apply(part, {
      op: 'setContentControlProperties',
      controlId: controlIds(part)[0]!,
      tag: 'tagged',
      alias: 'Titled',
      lock: 'sdtLocked',
    });
    const properties = contentControlPropertiesOf(controlOf(next));
    expect([properties.tag, properties.alias, properties.lock, properties.id]).toEqual([
      'tagged',
      'Titled',
      'sdtLocked',
      5,
    ]);
    const xml = serializeOoxmlPart(next);
    expect(xml.indexOf('w:alias')).toBeLessThan(xml.indexOf('w:tag'));
    expect(xml.indexOf('w:tag')).toBeLessThan(xml.indexOf('w:id'));
    expect(xml.indexOf('w:id')).toBeLessThan(xml.indexOf('w:lock'));
    expect(xml.indexOf('w:lock')).toBeLessThan(xml.indexOf('w:text'));
  });

  test('insertContentControl wraps a range and allocates an id from the document maximum', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:id w:val="41"/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
        `<w:p><w:r><w:t>hello world</w:t></w:r></w:p>`
    );
    const paragraph = paragraphs(part)[1]!;
    const next = apply(part, {
      op: 'insertContentControl',
      paragraphId: paragraph.id,
      start: 0,
      end: 5,
      type: 'plainText',
      tag: 'greeting',
    });
    const inserted = contentControlsIn(next.root).find(
      (entry) => contentControlPropertiesOf(entry.node).tag === 'greeting'
    );
    expect(inserted).toBeDefined();
    expect(contentControlTextOf(inserted!.node)).toBe('hello');
    expect(contentControlPropertiesOf(inserted!.node).id).toBe(42);
    // The paragraph still reads the same characters — a wrapper is not an edit.
    expect(contentControlPropertiesOf(inserted!.node).type).toBe('plainText');
  });

  test('removeContentControl keeps the content it wrapped', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>kept</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const next = apply(part, {
      op: 'removeContentControl',
      controlId: controlIds(part)[0]!,
      keepContent: true,
    });
    expect(contentControlsIn(next.root)).toHaveLength(0);
    expect(paragraphs(next)).toHaveLength(1);
    expect(serializeOoxmlPart(next)).toContain('kept');
  });

  test('removeContentControl can take the content with it', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>gone</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `<w:p><w:r><w:t>stays</w:t></w:r></w:p>`
    );
    const next = apply(part, {
      op: 'removeContentControl',
      controlId: controlIds(part)[0]!,
      keepContent: false,
    });
    expect(serializeOoxmlPart(next)).not.toContain('gone');
    expect(serializeOoxmlPart(next)).toContain('stays');
  });
});

// AN OFFSET CANNOT SAY "APPEND TO THIS FIELD". A boundary offset belongs to the run that starts
// there, so the offset at an inline control's trailing edge is the text AFTER the control — the
// same ambiguity `setRunProperties` answers with `targetRunIds`, answered the same way.
describe('an insertion can name the control it belongs to', () => {
  const inline = () =>
    parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );

  const spanOf = (part: OoxmlPart): { readonly start: number; readonly end: number } => {
    const control = contentControlsIn(part.root)[0]!;
    const found = paragraphOffsetIndex(paragraphs(part)[0] as never).spanOf(control.node);
    if (!found) throw new Error('the control has no span');
    return found;
  };

  test('the trailing edge appends inside the control instead of after it', () => {
    const part = inline();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: spanOf(part).end,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('MID#');
  });

  test('and it keeps the formatting of the run it appended to', () => {
    const part = inline();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: spanOf(part).end,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    // One bold run holding both, rather than the content rebuilt as plain text.
    expect(serializeOoxmlPart(next)).toContain('<w:b/>');
    expect(serializeOoxmlPart(next)).toMatch(/<w:b\/><\/w:rPr><w:t>MID#<\/w:t>/);
  });

  test('the leading edge lands where it already landed', () => {
    const part = inline();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: spanOf(part).start,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('#MID');
  });

  test('an empty control gets a run to hold the text', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/></w:sdtPr><w:sdtContent/></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: 3,
      text: 'FILLED',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('FILLED');
  });

  test('a name no control carries is refused, not written somewhere else', () => {
    const part = inline();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 3,
        text: '#',
        inside: 'no-such-node',
      })
    ).toBe('unknown-content-control');
  });
});

// `inside` SAYS WHERE THE TEXT GOES, so what it names has to be checked before it is believed.
// A name that resolves to a paragraph, to a control in another paragraph, or to nothing at all
// would otherwise be taken at its word: the operation would classify as a value write addressed
// at a control — the reach that forms protection exempts — while the applier wrote wherever the
// offset pointed. The name is validated against the addressed paragraph, and a bad one refuses.
describe('a named owner is checked before it is trusted', () => {
  const oneControl = () =>
    parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>elsewhere</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="g"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>FAR</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );

  test('a name that is a paragraph, not a control, is refused', () => {
    const part = oneControl();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 0,
        text: 'X',
        inside: paragraphs(part)[0]!.id,
      })
    ).toBe('not-a-content-control');
  });

  test('a name that is a run inside the control is refused as well', () => {
    const part = oneControl();
    const control = contentControlsIn(part.root)[0]!.node;
    const run = findRun(control);
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 4,
        text: 'X',
        inside: run.id,
      })
    ).toBe('not-a-content-control');
  });

  test('a control in another paragraph is not this paragraph’s owner', () => {
    const part = oneControl();
    const far = contentControlsIn(part.root)[1]!.node;
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 4,
        text: 'X',
        inside: far.id,
      })
    ).toBe('unknown-content-control');
  });

  test('and the foreign control is left exactly as it was', () => {
    const part = oneControl();
    const far = contentControlsIn(part.root)[1]!.node;
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: 4,
      text: 'PWNED',
      inside: far.id,
    });
    expect(result.ok).toBe(false);
    expect(serializeOoxmlPart(part)).not.toContain('PWNED');
  });

  test('an offset outside the named control’s own span is refused', () => {
    const part = oneControl();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 0,
        text: 'X',
        inside: contentControlsIn(part.root)[0]!.node.id,
      })
    ).toBe('offset-out-of-range');
  });

  test('a demoted w:sdt is not a control to write into', () => {
    // A `w:sdt` the read demoted to generic is markup nobody could type; naming it is a mistake,
    // and answering it with a write would be writing into something the model does not model.
    // Out of schema order — content before properties — so the read keeps it as generic markup.
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtContent/><w:sdtPr><w:tag w:val="f"/></w:sdtPr></w:sdt></w:p>`
    );
    const demoted = findDemotedSdt(part);
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 3,
        text: 'X',
        inside: demoted,
      })
    ).toBe('not-a-content-control');
  });

  test('the honest case still writes', () => {
    const part = oneControl();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: 6,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('MID#');
  });
});

function findRun(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'run') return node;
  if (node.kind === 'textValue') throw new Error('no run');
  for (const child of node.children) {
    try {
      return findRun(child);
    } catch {
      continue;
    }
  }
  throw new Error('no run');
}

function findDemotedSdt(part: OoxmlPart): string {
  const walk = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'generic' && node.localName === 'sdt') return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('the read did not demote the sdt');
  return found;
}

// v2 editor-facing string operations retain their independent regression coverage.
const V2_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V2_W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const V2_W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

function loadV2(body: string, extra = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${V2_W}" xmlns:w14="${V2_W14}" xmlns:w15="${V2_W15}"${extra}><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function applyV2(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

function rejectV2(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected a rejection');
  return result.reason;
}

function findByIdV2(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.kind === 'textValue') return node.id === id ? node : null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findByIdV2(child, id);
    if (found) return found;
  }
  return null;
}

function firstSdtV2(part: OoxmlPart): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === 'sdt') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('no sdt');
  return found;
}

function attributeOfV2(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamedV2(parent: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (parent.kind === 'textValue') return undefined;
  return parent.children.find(
    (child) => child.kind !== 'textValue' && child.localName === localName
  );
}

const V2_PARAGRAPH = '/word/document.xml#0.0.0';

describe('inline content controls contribute UTF-16 offsets', () => {
  test('segmentsOf includes runs inside an inline sdt', () => {
    const part = loadV2(
      '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>mid</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
    );
    const paragraph = findByIdV2(part.root, V2_PARAGRAPH);
    expect(paragraph?.kind).toBe('paragraph');
    if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('no paragraph');
    expect(paragraphTextOf(part, V2_PARAGRAPH)).toBe('before mid after');
    expect(segmentsOf(paragraph).at(-1)?.end).toBe(16);
  });

  test('deleteText can erase text inside an inline control', () => {
    const part = loadV2(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>CD</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>ef</w:t></w:r></w:p>'
    );
    const next = applyV2(part, { op: 'deleteText', paragraphId: V2_PARAGRAPH, start: 2, end: 4 });
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('abef');
    expect(firstSdtV2(next)).toBeTruthy();
  });
});

describe('setContentControlValue', () => {
  test('text control replaces content and clears showingPlcHdr', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>Enter name</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdtV2(part);
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: 'Ada',
    });
    const updated = findContentControl(next, control.id)!;
    expect(childNamedV2(childNamedV2(updated, 'sdtPr')!, 'showingPlcHdr')).toBeUndefined();
    const content = childNamedV2(updated, 'sdtContent')!;
    const text = [
      ...(function* walk(node: OoxmlNode): Generator<string> {
        if (node.kind === 'textValue') {
          yield node.value;
          return;
        }
        for (const child of node.children) yield* walk(child);
      })(content),
    ].join('');
    expect(text).toBe('Ada');
    expect(updated.id).toBe(control.id);
  });

  test('dropdown accepts a listed value and updates lastValue', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:dropDownList>' +
        '<w:listItem w:displayText="One" w:value="1"/>' +
        '<w:listItem w:displayText="Two" w:value="2"/>' +
        '</w:dropDownList></w:sdtPr>' +
        '<w:sdtContent><w:p><w:pPr><w:spacing w:after="120"/></w:pPr>' +
        '<w:r><w:t>One</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdtV2(part);
    const originalParagraph = childNamedV2(childNamedV2(control, 'sdtContent')!, 'p')!;
    expect(
      rejectV2(part, { op: 'setContentControlValue', controlId: control.id, value: '9' })
    ).toBe('invalidArgs');
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: '2',
    });
    const list = childNamedV2(
      childNamedV2(findContentControl(next, control.id)!, 'sdtPr')!,
      'dropDownList'
    )!;
    expect(attributeOfV2(list, 'lastValue')).toBe('2');
    const updatedParagraph = childNamedV2(
      childNamedV2(findContentControl(next, control.id)!, 'sdtContent')!,
      'p'
    )!;
    expect(updatedParagraph.id).toBe(originalParagraph.id);
    expect(
      attributeOfV2(childNamedV2(childNamedV2(updatedParagraph, 'pPr')!, 'spacing')!, 'after')
    ).toBe('120');
  });

  test('combo accepts a free value', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:comboBox>' +
        '<w:listItem w:displayText="Red" w:value="r"/>' +
        '</w:comboBox></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>Red</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdtV2(part);
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: 'custom',
    });
    const list = childNamedV2(
      childNamedV2(findContentControl(next, control.id)!, 'sdtPr')!,
      'comboBox'
    )!;
    expect(attributeOfV2(list, 'lastValue')).toBe('custom');
  });

  test('combo keeps four-digit hexadecimal text unchanged', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:comboBox/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>old</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdtV2(part);
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: '2612',
    });
    expect(collectTextV2(childNamedV2(findContentControl(next, control.id)!, 'sdtContent')!)).toBe(
      '2612'
    );
  });

  test('checkbox toggles w14:checked and rewrites the glyph', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr><w14:checkbox>' +
        '<w14:checked w14:val="0"/>' +
        '<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>' +
        '<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>' +
        '</w14:checkbox></w:sdtPr>' +
        '<w:sdtContent><w:r><w:sym w:font="MS Gothic" w:char="2610"/></w:r></w:sdtContent>' +
        '</w:sdt></w:p>'
    );
    const control = firstSdtV2(part);
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: 'true',
    });
    const checkbox = childNamedV2(
      childNamedV2(findContentControl(next, control.id)!, 'sdtPr')!,
      'checkbox'
    )!;
    const checked = childNamedV2(checkbox, 'checked')!;
    expect(attributeOfV2(checked, 'val')).toBe('1');
    const walk = (node: OoxmlNode): OoxmlNode | null => {
      if (node.kind !== 'textValue' && node.localName === 'sym') return node;
      if (node.kind === 'textValue') return null;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    expect(attributeOfV2(walk(findContentControl(next, control.id)!)!, 'char')).toBe('2612');
  });

  test('date writes fullDate and formatted display text', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">' +
        '<w:dateFormat w:val="yyyy-MM-dd"/>' +
        '</w:date></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>2020-01-01</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdtV2(part);
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: '2024-07-04',
    });
    const date = childNamedV2(
      childNamedV2(findContentControl(next, control.id)!, 'sdtPr')!,
      'date'
    )!;
    expect(attributeOfV2(date, 'fullDate')).toBe('2024-07-04T00:00:00Z');
    expect(collectTextV2(childNamedV2(findContentControl(next, control.id)!, 'sdtContent')!)).toBe(
      '2024-07-04'
    );
  });

  test('date accepts leap-day and normalizes date-time zones', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">' +
        '<w:dateFormat w:val="yyyy-MM-dd"/>' +
        '</w:date></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>2020-01-01</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const id = firstSdtV2(part).id;
    const leap = applyV2(part, {
      op: 'setContentControlValue',
      controlId: id,
      value: '2024-02-29T15:30:00+02:00',
    });
    expect(
      attributeOfV2(
        childNamedV2(childNamedV2(findContentControl(leap, id)!, 'sdtPr')!, 'date')!,
        'fullDate'
      )
    ).toBe('2024-02-29T15:30:00+02:00');
  });

  test('date refuses impossible calendar dates and malformed suffixes', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">' +
        '<w:dateFormat w:val="yyyy-MM-dd"/>' +
        '</w:date></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>2020-01-01</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const id = firstSdtV2(part).id;
    expect(
      rejectV2(part, { op: 'setContentControlValue', controlId: id, value: '2024-02-31' })
    ).toBe('invalidArgs');
    expect(
      rejectV2(part, { op: 'setContentControlValue', controlId: id, value: '2023-02-29' })
    ).toBe('invalidArgs');
    expect(
      rejectV2(part, { op: 'setContentControlValue', controlId: id, value: '2024-04-31' })
    ).toBe('invalidArgs');
    expect(
      rejectV2(part, { op: 'setContentControlValue', controlId: id, value: '2024-01-01Tgarbage' })
    ).toBe('invalidArgs');
    expect(
      rejectV2(part, { op: 'setContentControlValue', controlId: id, value: '2024-01-01 00:00:00Z' })
    ).toBe('invalidArgs');
  });

  test('bound controls refuse value edits', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr>' +
        '<w:dataBinding w:xpath="/a" w:storeItemID="{GUID}"/>' +
        '<w:text/>' +
        '</w:sdtPr><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    expect(
      rejectV2(part, {
        op: 'setContentControlValue',
        controlId: firstSdtV2(part).id,
        value: 'y',
      })
    ).toBe('bound');
  });

  test('repeating section ops are unsupported', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w15:repeatingSection/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>item</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const id = firstSdtV2(part).id;
    expect(rejectV2(part, { op: 'addRepeatingSectionItem', controlId: id })).toBe('unsupported');
    expect(rejectV2(part, { op: 'removeRepeatingSectionItem', controlId: id, index: 0 })).toBe(
      'unsupported'
    );
    expect(rejectV2(part, { op: 'setContentControlValue', controlId: id, value: 'x' })).toBe(
      'unsupported'
    );
  });
});

describe('removeContentControl', () => {
  test('unwraps keeping content and identity of runs', () => {
    const part = loadV2(
      '<w:p><w:r><w:t>a</w:t></w:r>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>b</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>c</w:t></w:r></w:p>'
    );
    const control = firstSdtV2(part);
    const contentRun = childNamedV2(childNamedV2(control, 'sdtContent')!, 'r')!;
    const next = applyV2(part, { op: 'removeContentControl', controlId: control.id });
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('abc');
    expect(findContentControl(next, control.id)).toBeNull();
    expect(findByIdV2(next.root, contentRun.id)?.kind).toBe('run');
  });

  test('explicit remove publishes flow-structural impact', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>body</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const result = applyTreeOp(part, {
      op: 'removeContentControl',
      controlId: firstSdtV2(part).id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.effect.impact).toBe('flow-structural');
    expect(paragraphTextOf(result.part, V2_PARAGRAPH)).toBe('body');
  });

  test('preserves non-property extension children beside sdtContent', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>body</w:t></w:r></w:sdtContent>' +
        '<w:extLst><w:ext w:uri="{test}"/></w:extLst></w:sdt></w:p>'
    );
    const control = firstSdtV2(part);
    const extension = childNamedV2(control, 'extLst')!;
    const next = applyV2(part, { op: 'removeContentControl', controlId: control.id });
    expect(findContentControl(next, control.id)).toBeNull();
    expect(findByIdV2(next.root, extension.id)?.localName).toBe('extLst');
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('body');
  });

  test('refuses unwrap when duplicate sdtContent would drop authored markup', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr/>' +
        '<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent>' +
        '<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent>' +
        '</w:sdt></w:p>'
    );
    const control = firstSdtV2(part);
    expect(rejectV2(part, { op: 'removeContentControl', controlId: control.id })).toBe(
      'tree-invariant'
    );
    expect(findContentControl(part, control.id)).not.toBeNull();
  });

  test('preserves foreign-namespace sdtPr/sdtEndPr siblings during unwrap', () => {
    const X = 'urn:hostile';
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr/>' +
        `<x:sdtPr xmlns:x="${X}" x:keep="pr"/>` +
        '<w:sdtContent><w:r><w:t>body</w:t></w:r></w:sdtContent>' +
        `<x:sdtEndPr xmlns:x="${X}" x:keep="end"/>` +
        '</w:sdt></w:p>',
      ` xmlns:x="${X}"`
    );
    const control = firstSdtV2(part);
    const foreignPr = control.children.find(
      (child) =>
        child.kind !== 'textValue' && child.localName === 'sdtPr' && child.namespaceUri === X
    )!;
    const foreignEnd = control.children.find(
      (child) =>
        child.kind !== 'textValue' && child.localName === 'sdtEndPr' && child.namespaceUri === X
    )!;
    const next = applyV2(part, { op: 'removeContentControl', controlId: control.id });
    expect(findContentControl(next, control.id)).toBeNull();
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('body');
    expect(findByIdV2(next.root, foreignPr.id)?.namespaceUri).toBe(X);
    expect(findByIdV2(next.root, foreignEnd.id)?.namespaceUri).toBe(X);
    expect(serializeOoxmlPart(next)).toContain('x:keep="pr"');
    expect(serializeOoxmlPart(next)).toContain('x:keep="end"');
  });
});

function reopenV2(part: OoxmlPart): OoxmlPart {
  const saved = serializeOoxmlPart(part);
  const result = readOoxmlPart(saved, { name: part.name, contentType: part.contentType });
  if (!result.ok) throw new Error(`reopenV2 failed: ${result.reason}`);
  return result.part;
}

function collectTextV2(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(collectTextV2).join('');
}

describe('showingPlcHdr first-input replacement', () => {
  test('typing at the end of a tracked placeholder stays inside the control', () => {
    const part = loadV2(
      '<w:p><w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' +
        '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Click to enter text</w:t></w:r></w:sdtContent>' +
        '</w:sdt></w:ins><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
    );
    const control = firstSdtV2(part);
    const next = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 19,
      text: '#',
    });
    const updated = findContentControl(next, control.id)!;
    expect(collectTextV2(childNamedV2(updated, 'sdtContent')!)).toBe('#');
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('# after');
    expect(isShowingPlaceholder(updated)).toBe(false);
  });

  test('insertText replaces the entire literal prompt and clears showingPlcHdr', () => {
    const part = loadV2(
      '<w:p><w:r><w:t>x</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Enter name</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>y</w:t></w:r></w:p>'
    );
    const control = firstSdtV2(part);
    // Caret inside the prompt (offset 1 is past the leading "x").
    const next = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 3,
      text: 'Ada',
    });
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('xAday');
    const updated = findContentControl(next, control.id)!;
    expect(isShowingPlaceholder(updated)).toBe(false);
    expect(collectTextV2(childNamedV2(updated, 'sdtContent')!)).toBe('Ada');
  });

  test('foreign-namespace showingPlcHdr does not trigger destructive replacement', () => {
    const X = 'urn:ext';
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr>' +
        `<x:showingPlcHdr xmlns:x="${X}" x:keep="1"/>` +
        '<w:text/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>REAL</w:t></w:r></w:sdtContent></w:sdt></w:p>',
      ` xmlns:x="${X}"`
    );
    const control = firstSdtV2(part);
    expect(isShowingPlaceholder(control)).toBe(false);
    const next = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 2,
      text: 'X',
    });
    const updated = findContentControl(next, control.id)!;
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('REXAL');
    expect(collectTextV2(childNamedV2(updated, 'sdtContent')!)).toBe('REXAL');
    const foreign = childNamedV2(childNamedV2(updated, 'sdtPr')!, 'showingPlcHdr');
    expect(foreign?.namespaceUri).toBe(X);
    expect(serializeOoxmlPart(next)).toContain('x:keep="1"');
  });

  test('save/reopenV2 does not leave showingPlcHdr over user content', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>Enter project name</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdtV2(part);
    // Block control: the paragraph inside is the editable target.
    const innerPara = childNamedV2(childNamedV2(control, 'sdtContent')!, 'p')!;
    const next = applyV2(part, {
      op: 'insertText',
      paragraphId: innerPara.id,
      offset: 0,
      text: 'Apollo',
    });
    const reopened = reopenV2(next);
    const after = findContentControl(reopened, control.id)!;
    expect(isShowingPlaceholder(after)).toBe(false);
    expect(serializeOoxmlPart(reopened)).not.toContain('showingPlcHdr');
    expect(collectTextV2(childNamedV2(after, 'sdtContent')!)).toBe('Apollo');
  });

  test('emptying a filled control shows the prompt again, as Word does (no glossary)', () => {
    // The wrapper stays and the type's own prompt returns under `w:showingPlcHdr`, so the
    // control never becomes a zero-width gap the caret cannot enter.
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Prompt</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const control = firstSdtV2(part);
    const filled = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 0,
      text: 'Hi',
    });
    expect(isShowingPlaceholder(findContentControl(filled, control.id)!)).toBe(false);
    const emptied = applyV2(filled, {
      op: 'deleteText',
      paragraphId: V2_PARAGRAPH,
      start: 0,
      end: 2,
    });
    const after = findContentControl(emptied, control.id)!;
    expect(isShowingPlaceholder(after)).toBe(true);
    expect(paragraphTextOf(emptied, V2_PARAGRAPH)).toBe('Click here to enter text.');
    // The restored prompt is a prompt: the next keystroke replaces it whole.
    const again = applyV2(emptied, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 0,
      text: 'Yo',
    });
    expect(paragraphTextOf(again, V2_PARAGRAPH)).toBe('Yo');
    expect(isShowingPlaceholder(findContentControl(again, control.id)!)).toBe(false);
  });

  test('glossary docPart is preserved across the fill and the restore', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr>' +
        '<w:placeholder><w:docPart w:val="DefaultPlaceholder"/></w:placeholder>' +
        '<w:showingPlcHdr/><w:text/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>Click here</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const control = firstSdtV2(part);
    expect(hasGlossaryPlaceholderRef(control)).toBe(true);
    const filled = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 0,
      text: 'Data',
    });
    const after = findContentControl(filled, control.id)!;
    expect(isShowingPlaceholder(after)).toBe(false);
    expect(hasGlossaryPlaceholderRef(after)).toBe(true);
    const emptied = applyV2(filled, {
      op: 'deleteText',
      paragraphId: V2_PARAGRAPH,
      start: 0,
      end: 4,
    });
    // The store lane cannot read the glossary, so the type's prompt stands in for the
    // block's text; the reference itself survives for Word and for the next open.
    const restored = findContentControl(emptied, control.id)!;
    expect(isShowingPlaceholder(restored)).toBe(true);
    expect(hasGlossaryPlaceholderRef(restored)).toBe(true);
  });

  test('bound refuses before a placeholder transition', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr>' +
        '<w:showingPlcHdr/>' +
        '<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>' +
        '<w:text/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>Prompt</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    // Inside the prompt: at an outer edge the insert lands beside a bound control instead.
    expect(
      rejectV2(part, { op: 'insertText', paragraphId: V2_PARAGRAPH, offset: 2, text: 'x' })
    ).toBe('bound');
    expect(isShowingPlaceholder(firstSdtV2(part))).toBe(true);
  });
});

describe('w:temporary unwrap on first content edit', () => {
  test('insertText unwraps a temporary control keeping the edited content', () => {
    const part = loadV2(
      '<w:p><w:r><w:t>a</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:temporary/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>b</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>c</w:t></w:r></w:p>'
    );
    const controlId = firstSdtV2(part).id;
    const next = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 1,
      text: 'X',
    });
    expect(findContentControl(next, controlId)).toBeNull();
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('aXbc');
  });

  test('placeholder replace and temporary unwrap share one write', () => {
    const part = loadV2(
      '<w:p><w:sdt><w:sdtPr><w:temporary/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Prompt</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const controlId = firstSdtV2(part).id;
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 0,
      text: 'Ok',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.effect.impact).toBe('flow-structural');
    expect(findContentControl(result.part, controlId)).toBeNull();
    expect(paragraphTextOf(result.part, V2_PARAGRAPH)).toBe('Ok');
  });

  test('setContentControlValue unwraps a temporary control', () => {
    const part = loadV2(
      '<w:sdt><w:sdtPr><w:temporary/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>old</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const controlId = firstSdtV2(part).id;
    const next = applyV2(part, {
      op: 'setContentControlValue',
      controlId,
      value: 'new',
    });
    expect(findContentControl(next, controlId)).toBeNull();
    expect(collectTextV2(next.root)).toContain('new');
  });
});

describe('removeContentControl keepContent: false', () => {
  test('takes the wrapper AND its content as one unit', () => {
    const part = loadV2(
      '<w:p><w:r><w:t>aa</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>CHIP</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>zz</w:t></w:r></w:p>'
    );
    const controlId = firstSdtV2(part).id;
    const next = applyV2(part, { op: 'removeContentControl', controlId, keepContent: false });
    expect(findContentControl(next, controlId)).toBeNull();
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('aazz');
  });

  test('a wrapper-locked control refuses deletion; content lock alone does not', () => {
    const locked = loadV2(
      '<w:p><w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>KEEP</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(
      rejectV2(locked, {
        op: 'removeContentControl',
        controlId: firstSdtV2(locked).id,
        keepContent: false,
      })
    ).toBe('locked');
  });
});

describe('boundary carets beside locked controls', () => {
  const LOCKED =
    '<w:p><w:r><w:t>aa</w:t></w:r>' +
    '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
    '<w:sdtContent><w:r><w:t>LOCK</w:t></w:r></w:sdtContent></w:sdt>' +
    '<w:r><w:t>zz</w:t></w:r></w:p>';

  test('an insert at the locked chip LEFT edge lands beside it, with either bias', () => {
    // Entering a content-locked chip can only be refused, so the leading edge resolves beside
    // the chip for both biases. Validation reads the same landing, so the write is allowed and
    // the chip keeps its text. Before this, a chip at a paragraph start had no position before
    // it that accepted a keystroke.
    for (const bias of [undefined, 'right'] as const) {
      const part = loadV2(LOCKED);
      const next = applyV2(part, {
        op: 'insertText',
        paragraphId: V2_PARAGRAPH,
        offset: 2,
        text: 'X',
        ...(bias ? { bias } : {}),
      });
      expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('aaXLOCKzz');
      expect(collectTextV2(firstSdtV2(next))).toBe('LOCK');
    }
  });

  test('an insert strictly inside the locked chip is still refused', () => {
    const part = loadV2(LOCKED);
    expect(
      rejectV2(part, { op: 'insertText', paragraphId: V2_PARAGRAPH, offset: 4, text: 'X' })
    ).toBe('locked');
  });

  test('typing after a locked chip NESTED in an outer control stays inside the outer one', () => {
    // The caret leaves only the INNER container: the fresh run lands after the chip inside
    // the outer control's content, not jumped out past the top-level host.
    const part = loadV2(
      '<w:p><w:r><w:t>aa</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:alias w:val="outer"/></w:sdtPr><w:sdtContent>' +
        '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>LOCK</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:sdtContent></w:sdt></w:p>'
    );
    const next = applyV2(part, {
      op: 'insertText',
      paragraphId: V2_PARAGRAPH,
      offset: 6,
      text: 'X',
    });
    expect(paragraphTextOf(next, V2_PARAGRAPH)).toBe('aaLOCKX');
    const outer = firstSdtV2(next);
    // The typed character is inside the OUTER control...
    expect(collectTextV2(outer)).toBe('LOCKX');
    // ...and the locked inner chip kept exactly its own text.
    const findInner = (node: OoxmlNode): OoxmlNode | null => {
      if (node.kind === 'textValue') return null;
      for (const child of node.children) {
        if (child.kind !== 'textValue' && child.localName === 'sdt') return child;
        const found = findInner(child);
        if (found) return found;
      }
      return null;
    };
    const inner = findInner(outer);
    expect(inner).not.toBeNull();
    expect(collectTextV2(inner!)).toBe('LOCK');
  });
});

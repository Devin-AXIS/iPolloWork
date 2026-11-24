// Word's Protect Document, at the store: reading `w:documentProtection`, writing it in schema
// order, refusing to lift a password, and the read-only / comments-only refusals.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  applyHeaderFooterLifecycleOp,
  formsProtectionEnabled,
  readDocumentProtection,
  readOoxmlPackage,
  readTrackingSettings,
  serializeOoxmlPart,
  type OoxmlPackage,
} from '../index.ts';
import {
  documentProtectionRefusal,
  lifecycleProtectionRefusal,
} from '../store/forms-protection.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function build(settingsInner: string | null): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (settingsInner === null
          ? ''
          : '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (settingsInner === null
          ? ''
          : `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`) +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`
    ),
  };
  if (settingsInner !== null) {
    entries['word/settings.xml'] = strToU8(
      `<w:settings xmlns:w="${W}">${settingsInner}</w:settings>`
    );
  }
  const result = readOoxmlPackage(zipSync(entries));
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

const settingsXml = (pkg: OoxmlPackage): string =>
  serializeOoxmlPart(pkg.parts.get('/word/settings.xml')!);
const settingsRoot = (pkg: OoxmlPackage) => pkg.parts.get('/word/settings.xml')?.root ?? null;

function apply(pkg: OoxmlPackage, enforce: boolean): OoxmlPackage {
  const result = applyHeaderFooterLifecycleOp(pkg, { op: 'setDocumentProtection', enforce });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.package;
}

function refuse(pkg: OoxmlPackage, enforce: boolean): string {
  const result = applyHeaderFooterLifecycleOp(pkg, { op: 'setDocumentProtection', enforce });
  if (result.ok) throw new Error('expected a refusal');
  return `${result.reason}:${result.detail ?? ''}`;
}

const FORMS = '<w:documentProtection w:edit="forms" w:enforcement="1"/>';
const insertOp = { op: 'insertText', paragraphId: 'p', offset: 0, text: 'x' } as const;
const PASSWORD =
  '<w:documentProtection w:edit="forms" w:enforcement="1" w:cryptProviderType="rsaAES" ' +
  'w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="14" ' +
  'w:cryptSpinCount="100000" w:hash="abc=" w:salt="def="/>';

describe('reading document protection', () => {
  test('no settings part, no element, and an unenforced element are all "not protected"', () => {
    expect(readDocumentProtection(settingsRoot(build(null)))).toEqual({
      edit: 'none',
      enforced: false,
      password: false,
    });
    expect(readDocumentProtection(settingsRoot(build(''))).enforced).toBe(false);
    const lifted = readDocumentProtection(
      settingsRoot(build('<w:documentProtection w:edit="forms" w:enforcement="0"/>'))
    );
    expect(lifted).toEqual({ edit: 'forms', enforced: false, password: false });
  });

  test('an absent @w:enforcement is not enforced, for every restriction', () => {
    // `ST_OnOff` ATTRIBUTE, not a `CT_OnOff` element: there is no presence to read as a yes,
    // and Word writes `w:enforcement="1"` whenever it protects. Reading absence as enforced
    // would make a document from a producer that omits one attribute completely dead.
    for (const edit of ['readOnly', 'comments', 'trackedChanges', 'forms'] as const) {
      const state = readDocumentProtection(
        settingsRoot(build(`<w:documentProtection w:edit="${edit}"/>`))
      );
      expect(state).toEqual({ edit, enforced: false, password: false });
    }
    // And the document is editable, rather than locked by an omission.
    const settings = build('<w:documentProtection w:edit="readOnly"/>').parts.get(
      '/word/settings.xml'
    );
    expect(documentProtectionRefusal(settings, insertOp)).toBeNull();
    expect(
      readTrackingSettings(settingsRoot(build('<w:documentProtection w:edit="forms"/>')))
        .restrictedToForms
    ).toBe(false);
  });

  test('one reading of @w:enforcement, so the menu and the store cannot disagree', () => {
    for (const inner of [
      '<w:documentProtection w:edit="forms"/>',
      '<w:documentProtection w:edit="forms" w:enforcement="1"/>',
      '<w:documentProtection w:edit="trackedChanges"/>',
      '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>',
    ]) {
      const root = settingsRoot(build(inner));
      const state = readDocumentProtection(root);
      const tracking = readTrackingSettings(root);
      expect(formsProtectionEnabled(root)).toBe(state.edit === 'forms' && state.enforced);
      expect(tracking.restrictedToForms).toBe(state.edit === 'forms' && state.enforced);
      expect(tracking.restrictedToTrackedChanges).toBe(
        state.edit === 'trackedChanges' && state.enforced
      );
    }
  });

  test('a password attribute outside the WML namespace is not a password', () => {
    // A `.docx` is a zip of XML the sender controls, and one foreign attribute named `salt`
    // would otherwise disable Stop Protection for good on a document with no password.
    const foreign = build(
      '<w:documentProtection xmlns:x="urn:example" w:edit="forms" w:enforcement="1" x:salt="zzz"/>'
    );
    expect(readDocumentProtection(settingsRoot(foreign)).password).toBe(false);
  });

  test('every ST_DocProtect value reads back, and an unknown one reads as none', () => {
    for (const edit of ['readOnly', 'comments', 'trackedChanges', 'forms'] as const) {
      const state = readDocumentProtection(
        settingsRoot(build(`<w:documentProtection w:edit="${edit}" w:enforcement="1"/>`))
      );
      expect(state).toEqual({ edit, enforced: true, password: false });
    }
    expect(
      readDocumentProtection(
        settingsRoot(build('<w:documentProtection w:edit="everything" w:enforcement="1"/>'))
      ).edit
    ).toBe('none');
  });

  test('a password is reported, never verified', () => {
    expect(readDocumentProtection(settingsRoot(build(PASSWORD)))).toEqual({
      edit: 'forms',
      enforced: true,
      password: true,
    });
  });

  test('the tracking settings see enforced forms protection', () => {
    expect(readTrackingSettings(settingsRoot(build(FORMS))).restrictedToForms).toBe(true);
    expect(
      readTrackingSettings(
        settingsRoot(build('<w:documentProtection w:edit="forms" w:enforcement="0"/>'))
      ).restrictedToForms
    ).toBe(false);
    expect(readTrackingSettings(settingsRoot(build(''))).restrictedToForms).toBe(false);
  });
});

describe('the setDocumentProtection op', () => {
  test('enforcing writes forms protection in CT_Settings order', () => {
    const pkg = build(
      '<w:zoom w:percent="100"/><w:trackRevisions/><w:defaultTabStop w:val="720"/>'
    );
    const out = settingsXml(apply(pkg, true));
    const protection = out.indexOf('<w:documentProtection');
    expect(protection).toBeGreaterThan(out.indexOf('<w:trackRevisions'));
    expect(protection).toBeLessThan(out.indexOf('<w:defaultTabStop'));
    expect(out).toContain('w:edit="forms"');
    expect(out).toContain('w:enforcement="1"');
    expect(readDocumentProtection(settingsRoot(apply(pkg, true)))).toEqual({
      edit: 'forms',
      enforced: true,
      password: false,
    });
  });

  test('enforcing lands first when nothing precedes it, and creates a missing settings part', () => {
    const out = settingsXml(apply(build('<w:defaultTabStop w:val="720"/>'), true));
    expect(out.indexOf('<w:documentProtection')).toBeLessThan(out.indexOf('<w:defaultTabStop'));
    const created = apply(build(null), true);
    expect(readDocumentProtection(settingsRoot(created)).enforced).toBe(true);
  });

  test('lifting keeps the recorded mode and clears the enforcement, as Stop Protection does', () => {
    const out = settingsXml(apply(build(FORMS), false));
    expect(out).toContain('w:edit="forms"');
    expect(out).toContain('w:enforcement="0"');
    expect(readDocumentProtection(settingsRoot(apply(build(FORMS), false)))).toEqual({
      edit: 'forms',
      enforced: false,
      password: false,
    });
  });

  test('lifting any enforced mode works, and re-enforcing over it is refused', () => {
    const readOnly = build('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>');
    const lifted = apply(readOnly, false);
    expect(readDocumentProtection(settingsRoot(lifted))).toEqual({
      edit: 'readOnly',
      enforced: false,
      password: false,
    });
    // This row applies ONE restriction. Re-enforcing would rewrite the author's `readOnly`
    // into the weaker `forms`, so off-then-on would look like a round trip and would not be.
    expect(refuse(lifted, true)).toBe('invalidArgs:other-restriction');
    expect(refuse(readOnly, true)).toBe('invalidArgs:other-restriction');
  });

  test('enforcing keeps every attribute it does not decide', () => {
    // `@w:formatting` is Word's separate "limit formatting to a selection of styles"
    // restriction. A reader locking the form fields must not turn it off as a side effect.
    const styled = build(
      '<w:documentProtection w:edit="forms" w:formatting="1" w:enforcement="0"/>'
    );
    const out = settingsXml(apply(styled, true));
    expect(out).toContain('w:formatting="1"');
    expect(out).toContain('w:enforcement="1"');
    expect(settingsXml(apply(build(FORMS), false))).toContain('w:edit="forms"');
  });

  test('enforcing drops the password a lifted protection left behind', () => {
    const lifted = build(PASSWORD.replace('w:enforcement="1"', 'w:enforcement="0"'));
    const out = settingsXml(apply(lifted, true));
    expect(out).not.toContain('w:hash');
    expect(out).not.toContain('cryptProviderType');
    expect(readDocumentProtection(settingsRoot(apply(lifted, true))).password).toBe(false);
  });

  test('a password-protected document refuses to lift', () => {
    expect(refuse(build(PASSWORD), false)).toBe('invalidArgs:password');
  });

  test('a write that changes nothing is refused rather than recorded', () => {
    expect(refuse(build(FORMS), true)).toBe('invalidArgs:no-change');
    expect(refuse(build(''), false)).toBe('invalidArgs:no-change');
  });

  test('the package store commits it as one undoable package unit', () => {
    const pkg = build('');
    const store = new TreePackageStore(pkg, pkg.parts.get(pkg.mainDocumentPart)!);
    const result = store.applyLifecycleOp({ op: 'setDocumentProtection', enforce: true });
    expect(result.ok).toBe(true);
    expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(true);
    expect(store.undo()).not.toBeNull();
    expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(false);
    expect(store.redo()).not.toBeNull();
    expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(true);
  });
});

describe('read-only and comments-only refusals', () => {
  const settings = (inner: string) => build(inner).parts.get('/word/settings.xml');
  const insert = { op: 'insertText', paragraphId: 'p', offset: 0, text: 'x' } as const;
  const marker = {
    op: 'insertCommentMarker',
    paragraphId: 'p',
    start: 0,
    end: 1,
    commentId: '1',
  } as const;

  test('read-only refuses every op', () => {
    const readOnly = settings('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>');
    expect(documentProtectionRefusal(readOnly, insert)).toBe('locked');
    expect(documentProtectionRefusal(readOnly, marker as never)).toBe('locked');
  });

  test('comments-only admits the comment anchor and refuses the rest', () => {
    const comments = settings('<w:documentProtection w:edit="comments" w:enforcement="1"/>');
    expect(documentProtectionRefusal(comments, insert)).toBe('locked');
    expect(documentProtectionRefusal(comments, marker as never)).toBeNull();
  });

  test('a write that is not a story op is refused too', () => {
    // Furniture and note lifecycle never reach the per-op applier. Gating only that one left
    // "Remove header" deleting a part out of a document the same protection refused a
    // keystroke in.
    for (const mode of ['readOnly', 'comments'] as const) {
      const inner = `<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`;
      expect(documentProtectionRefusal(settings(inner))).toBe('locked');
      const store = new TreePackageStore(
        build(inner),
        build(inner).parts.get('/word/document.xml')!
      );
      expect(
        store.applyLifecycleOp({
          op: 'createHeaderFooter',
          sectionIndex: 0,
          kind: 'header',
          variant: 'default',
        }).ok
      ).toBe(false);
      expect(
        store.applyLifecycleOp({
          op: 'insertNote',
          noteKind: 'footnote',
          paragraphId: 'p',
          offset: 0,
        }).ok
      ).toBe(false);
    }
  });

  test('package-only comment writes respect the protection mode', () => {
    // Resolve, edit and delete carry no story op, so the per-op gate never sees them and the
    // package channel cannot refuse forms without also refusing a legitimate field fill.
    // Ungated, a form sent out for filling came back with every thread resolved by a reader
    // who could not type a character.
    for (const mode of ['forms', 'readOnly', 'comments'] as const) {
      const settings = build(
        `<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`
      ).parts.get('/word/settings.xml');
      expect(lifecycleProtectionRefusal(settings, { op: 'setCommentResolved' })).toBe(
        mode === 'comments' ? null : 'locked'
      );
      expect(lifecycleProtectionRefusal(settings, { op: 'deleteComments' })).toBe(
        mode === 'comments' ? null : 'locked'
      );
      expect(lifecycleProtectionRefusal(settings, { op: 'setCommentText' })).toBe(
        mode === 'comments' ? null : 'locked'
      );
    }
    const open = build('').parts.get('/word/settings.xml');
    expect(lifecycleProtectionRefusal(open, { op: 'setCommentResolved' })).toBeNull();
  });

  test('the protection toggle itself is never refused, or the document could not be unlocked', () => {
    for (const mode of ['readOnly', 'comments', 'forms'] as const) {
      const inner = `<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`;
      const pkg = build(inner);
      const store = new TreePackageStore(pkg, pkg.parts.get(pkg.mainDocumentPart)!);
      expect(store.applyLifecycleOp({ op: 'setDocumentProtection', enforce: false }).ok).toBe(true);
      expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(false);
    }
  });

  test('forms, tracked changes, lifted and absent protection are answered elsewhere', () => {
    for (const inner of [
      FORMS,
      '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>',
      '<w:documentProtection w:edit="readOnly" w:enforcement="0"/>',
      '',
    ]) {
      expect(documentProtectionRefusal(settings(inner), insert)).toBeNull();
    }
    expect(documentProtectionRefusal(null, insert)).toBeNull();
  });
});

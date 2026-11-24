import { expect, test } from 'bun:test';
import { readOoxmlPart, type HeadlessDocumentView } from '@docx-editor.dev/core/store';
import {
  compatibilityModeFromSettings,
  compatibilityProfileFromSettings,
} from '../compatibility/compatibility-profile.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const URI = 'http://schemas.microsoft.com/office/word';
function settings(body: string, namespace = W) {
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${namespace}" xmlns:x="urn:foreign">${body}</w:settings>`,
    { name: '/word/settings.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}
const setting = (mode: string) =>
  `<w:compatSetting w:name="compatibilityMode" w:uri="${URI}" w:val="${mode}"/>`;

test('projects every explicitly authored Word compatibility mode', () => {
  // Including the ones no lane branches on. A document declaring 16 is modern; one declaring
  // nothing is legacy. Reporting both as `undefined` would make those indistinguishable.
  for (const mode of ['11', '12', '14', '15', '16', '13', '17', '9999']) {
    expect(compatibilityModeFromSettings(settings(`<w:compat>${setting(mode)}</w:compat>`))).toBe(
      Number(mode)
    );
  }
  // Absent, malformed, or below Word's first mode: not a mode, so indistinguishable from absent.
  for (const mode of ['0', '10', '-1', '12.0', '+12', ' 12 ', 'NaN', '9999999999999999999999']) {
    expect(
      compatibilityModeFromSettings(settings(`<w:compat>${setting(mode)}</w:compat>`))
    ).toBeUndefined();
  }
  expect(compatibilityModeFromSettings(null)).toBeUndefined();
  expect(compatibilityModeFromSettings(settings(''))).toBeUndefined();
});

test('a valid mode declared directly under settings applies when compat holds none', () => {
  const profile = (body: string) => compatibilityProfileFromSettings(settings(body));
  expect(profile(setting('16')).modeValue).toBe(16);
  expect(profile(setting('14')).modeValue).toBe(14);
  // A valid declaration inside compat wins over one outside it.
  expect(profile(`${setting('16')}<w:compat>${setting('14')}</w:compat>`).modeValue).toBe(14);
  // An invalid declaration inside compat yields to a valid one outside it.
  const rescued = profile(`<w:compat>${setting('abc')}</w:compat>${setting('15')}`);
  expect(rescued.modeValue).toBe(15);
  expect(rescued.modeRefused).toBe(false);
  // An invalid declaration outside compat is ignored: it neither sets nor refuses a mode.
  for (const value of ['abc', '13a', '10']) {
    const ignored = profile(setting(value));
    expect(ignored.modeValue).toBeUndefined();
    expect(ignored.modeRefused).toBe(false);
  }
  // An invalid declaration inside compat still refuses the mode.
  expect(profile(`<w:compat>${setting('abc')}</w:compat>`).modeRefused).toBe(true);
  // Two valid declarations outside compat are as ambiguous as two inside it.
  expect(profile(setting('14') + setting('15')).modeValue).toBeUndefined();
});

test('requires the settings/compat path and expanded names, not a matching local name alone', () => {
  const valid = setting('14');
  const bodies = [
    // Outside compat, only a valid Word declaration counts.
    valid.replace(URI, 'urn:other'),
    valid.replace('compatibilityMode', 'other'),
    valid.replaceAll('w:compatSetting', 'x:compatSetting'),
    `<x:compat>${valid}</x:compat>`,
    `<w:compat>${valid.replaceAll('w:compatSetting', 'x:compatSetting')}</w:compat>`,
    ...['name', 'uri', 'val'].map(
      (attr) => `<w:compat>${valid.replace(`w:${attr}`, `x:${attr}`)}</w:compat>`
    ),
    `<w:compat>${valid.replace(URI, 'urn:other')}</w:compat>`,
    `<w:compat>${valid.replace('compatibilityMode', 'other')}</w:compat>`,
    `<w:compat>${valid}${setting('15')}</w:compat>`,
    `<w:compat><x:wrapper>${valid}</x:wrapper></w:compat>`,
  ];
  for (const body of bodies) expect(compatibilityModeFromSettings(settings(body))).toBeUndefined();
  expect(
    compatibilityModeFromSettings(settings(`<w:compat>${valid}</w:compat>`, 'urn:foreign'))
  ).toBeUndefined();
  const aliased = settings(`<w:compat>${valid}</w:compat>`);
  // Prefixes are fidelity metadata; namespace URIs remain authoritative.
  expect(compatibilityModeFromSettings({ ...aliased, prefix: 'another' })).toBe(14);
});

test('a retained style-dependency callback observes settings changes and removals', () => {
  let current = settings(`<w:defaultTabStop w:val="720"/><w:compat>${setting('14')}</w:compat>`);
  const deps = createDocumentStyleDependencies({
    settingsRoot: () => current,
  } as unknown as HeadlessDocumentView);
  expect(deps.defaultTabStopPt()).toBe(36);
  expect(deps.compatibilityMode?.()).toBe(14);
  current = settings(`<w:defaultTabStop w:val="1440"/><w:compat>${setting('15')}</w:compat>`);
  expect(deps.compatibilityMode?.()).toBe(15);
  expect(deps.defaultTabStopPt()).toBe(72);
  current = settings('');
  expect(deps.defaultTabStopPt()).toBe(36);
  expect(deps.compatibilityMode?.()).toBeUndefined();
});

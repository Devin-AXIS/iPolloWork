// A freshly minted external hyperlink relationship must match the package model shape that
// `readOoxmlPackage` builds after save and reopen — present in both `relationships` and
// `externalTargets`, not in `externalTargets` alone.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { ensureHyperlinkRelationship } from '../package/hyperlink-part.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from '../package/hyperlink.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function blankDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr/>' +
        '</w:body></w:document>'
    ),
  });
}

/** Stable view of one external hyperlink relationship across both package indexes. */
function hyperlinkRelationshipShape(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipId: string
): string {
  const internal = (pkg.relationships.get(ownerPart) ?? []).find(
    (record) => record.id === relationshipId
  );
  const external = pkg.externalTargets.find(
    (entry) => entry.ownerPart === ownerPart && entry.id === relationshipId
  );
  return JSON.stringify({
    internal: internal
      ? {
          id: internal.id,
          type: internal.type,
          rawTarget: internal.rawTarget,
          targetMode: internal.targetMode,
          order: internal.order,
        }
      : null,
    external: external
      ? {
          id: external.id,
          type: external.type,
          rawTarget: external.rawTarget,
          sinkSafe: external.sinkSafe,
        }
      : null,
  });
}

describe('ensureHyperlinkRelationship model shape', () => {
  test('minted hyperlink matches save-reopen shape in relationships and externalTargets', () => {
    const loaded = readOoxmlPackage(blankDoc());
    if (!loaded.ok) throw new Error(loaded.reason);
    const owner = loaded.package.mainDocumentPart;
    const url = 'https://example.com/mint-shape';

    const ensured = ensureHyperlinkRelationship(loaded.package, url);
    expect(ensured).not.toBeNull();
    const relationshipId = ensured!.relationshipId;
    const mintedShape = hyperlinkRelationshipShape(ensured!.pkg, owner, relationshipId);

    expect(
      (ensured!.pkg.relationships.get(owner) ?? []).some((record) => record.id === relationshipId)
    ).toBe(true);
    expect(
      ensured!.pkg.externalTargets.some(
        (entry) =>
          entry.ownerPart === owner &&
          entry.id === relationshipId &&
          entry.type === HYPERLINK_RELATIONSHIP_TYPE
      )
    ).toBe(true);

    const reopened = readOoxmlPackage(writeOoxmlPackage(ensured!.pkg));
    if (!reopened.ok) throw new Error(reopened.reason);
    const reopenedShape = hyperlinkRelationshipShape(reopened.package, owner, relationshipId);

    expect(reopenedShape).toEqual(mintedShape);
  });
});

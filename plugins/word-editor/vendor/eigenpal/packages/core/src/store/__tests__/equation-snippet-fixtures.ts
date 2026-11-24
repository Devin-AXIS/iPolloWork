// Flat OPC packages for the equation insertion tests: the accepted shape and its variants.

const PKG = 'http://schemas.microsoft.com/office/2006/xmlPackage';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** x squared, in OMML. */
export const X_SQUARED =
  '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>' +
  '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>';

/** The rels part every Flat OPC package from an Office host carries. */
export const RELS_PART =
  `<pkg:part pkg:name="/_rels/.rels" ` +
  `pkg:contentType="application/vnd.openxmlformats-package.relationships+xml" pkg:padding="512">` +
  `<pkg:xmlData><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" ` +
  `Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part>`;

/** A document part whose body is `body`. */
export function documentPart(body: string, documentAttributes = ''): string {
  return (
    `<pkg:part pkg:name="/word/document.xml" ` +
    `pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
    `<pkg:xmlData><w:document xmlns:w="${W}" xmlns:m="${M}"${documentAttributes}>` +
    `<w:body>${body}</w:body></w:document></pkg:xmlData></pkg:part>`
  );
}

/** A package of `parts`. */
export function flatOpc(
  parts: string,
  prologue = '<?xml version="1.0" standalone="yes"?>'
): string {
  return `${prologue}<pkg:package xmlns:pkg="${PKG}">${parts}</pkg:package>`;
}

/** The accepted shape: one paragraph, one inline equation, optional plain runs around it. */
export function equationPackage(paragraphContent = X_SQUARED): string {
  return flatOpc(RELS_PART + documentPart(`<w:p>${paragraphContent}</w:p>`));
}

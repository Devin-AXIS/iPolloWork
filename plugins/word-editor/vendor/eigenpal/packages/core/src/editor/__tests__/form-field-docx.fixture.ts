import { strToU8, zipSync } from 'fflate';

/** One editable date field followed by ordinary text, for adapter translation tests. */
export function formFieldDocx(protectedForm = false): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/settings" Target="settings.xml"/></Relationships>`,
        'word/settings.xml': `<w:settings xmlns:w="${w}">${protectedForm ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : ''}</w:settings>`,
        'word/document.xml': `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Date"/><w:textInput><w:type w:val="date"/><w:default w:val="01/02/2030"/><w:format w:val="MM/dd/yyyy"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>01/02/2030</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p></w:body></w:document>`,
      }).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
}

export const firstFormCatalogue = {
  textFormField: {
    title: 'Pole daty',
    defaultText: 'Wartość',
    selected: 'Wybrane pole',
    invalidTitle: 'Błąd daty',
    invalidDate: 'Podaj poprawną datę.',
  },
};
export const nextFormCatalogue = {
  textFormField: {
    title: 'Date field',
    defaultText: 'Value',
    selected: 'Field selected',
    invalidTitle: 'Date error',
    invalidDate: 'Enter a valid date.',
  },
};

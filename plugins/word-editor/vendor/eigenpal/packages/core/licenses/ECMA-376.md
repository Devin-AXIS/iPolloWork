# ECMA-376 derived tables

`src/store/package/drawing-preset-table.ts` is generated from `presetShapeDefinitions.xml` in the electronic annex of ECMA-376 Part 1, _Office Open XML File Formats — Fundamentals and Markup Language Reference_ (https://ecma-international.org/publications-and-standards/standards/ecma-376/). The generator, `scripts/generate-drawing-presets.mjs`, re-encodes each preset's adjust values, guide formulas, text rectangle and paths in a compact form, and omits adjust handles and connection sites. The table implements the preset geometry functionality of the standard in a standard-conformant product, as permitted by clause (iv) of the notice below.

Two smaller tables in this package also come from ECMA-376 Part 1, and the same terms apply to them:

- `src/layout/cjk-typography.ts`: the default line-break character sets of §17.3.1.16.
- `src/store/package/drawing-preset-colors.ts`: the color names of `ST_PresetColorVal`.

The following notice applies to these tables.

COPYRIGHT NOTICE

© Ecma International

By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.

This document may be copied, published and distributed to others, and certain derivative works of it may be prepared, copied, published, and distributed, in whole or in part, provided that the above copyright notice and this Copyright License and Disclaimer are included on all such copies and derivative works. The only derivative works that are permissible under this Copyright License and Disclaimer are:

(i) works which incorporate all or portion of this document for the purpose of providing commentary or explanation (such as an annotated version of the document),

(ii) works which incorporate all or portion of this document for the purpose of incorporating features that provide accessibility,

(iii) translations of this document into languages other than English and into different formats and

(iv) works by making use of this specification in standard conformant products by implementing (e.g. by copy and paste wholly or partly) the functionality therein.

However, the content of this document itself may not be modified in any way, including by removing the copyright notice or references to Ecma International, except as required to translate it into languages other than English or into a different format.

The official version of an Ecma International document is the English language version on the Ecma International website. In the event of discrepancies between a translated version and the official version, the official version shall govern.

The limited permissions granted above are perpetual and will not be revoked by Ecma International or its successors or assigns.

This document and the information contained herein is provided on an "AS IS" basis and ECMA INTERNATIONAL DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTY THAT THE USE OF THE INFORMATION HEREIN WILL NOT INFRINGE ANY OWNERSHIP RIGHTS OR ANY IMPLIED WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

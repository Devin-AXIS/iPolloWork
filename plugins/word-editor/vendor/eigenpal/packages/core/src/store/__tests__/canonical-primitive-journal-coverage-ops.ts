// Journal coverage fixtures for every authorable TreeDocOp kind (task 3.8).

import { planRevisionAuthorChange } from '../store/revision-author-change.ts';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import { storyRootsOf } from '../package/story-blocks.ts';
import { detectBodyTocs } from '../package/toc-detect.ts';
import type { TreeDocOp } from '../store/tree-ops.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import {
  findKind,
  firstParagraphId,
  M,
  paragraphIds,
  parseDrawingTemplate,
  PIC_URI,
  PNG,
  plainDoc,
  QA,
  R,
  tableIds,
  transactBody,
  W,
  W14,
  walkNodes,
  zipDoc,
  type JournalCoverageFixture,
} from './canonical-primitive-journal-coverage-support.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { readEquationSnippet } from '../store/equation-snippet.ts';
import { equationPackage, X_SQUARED } from './equation-snippet-fixtures.ts';

const TWO_P =
  '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p><w:sectPr/>';

const REF_FIELD_BODY =
  '<w:p><w:bookmarkStart w:id="1" w:name="_Ref1"/><w:r><w:t>Target</w:t></w:r>' +
  '<w:bookmarkEnd w:id="1"/></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>old</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr/>';

const MATH_P =
  '<w:p><w:r><w:t>A</w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>' +
  '<w:r><w:t>Z</w:t></w:r></w:p><w:p><w:r><w:t>y</w:t></w:r></w:p><w:sectPr/>';

const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>d</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:t>after</w:t></w:r></w:p><w:sectPr/>';

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
  '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
  '<w:lvlText w:val="%1.%2."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const LIST_P =
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  '<w:r><w:t>Item</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr/>';

const LINK_P =
  '<w:p><w:hyperlink r:id="rIdH"><w:r><w:t>Link</w:t></w:r></w:hyperlink>' +
  '<w:r><w:t>X</w:t></w:r></w:p><w:p><w:r><w:t>plain</w:t></w:r></w:p><w:sectPr/>';

const INS_P =
  '<w:p><w:r><w:t>ab</w:t></w:r>' +
  `<w:ins w:id="1" w:author="QA" w:date="${QA.date}"><w:r><w:t>X</w:t></w:r></w:ins>` +
  '</w:p><w:p><w:r><w:t>cd</w:t></w:r></w:p><w:sectPr/>';

const SDT =
  '<w:p><w:sdt><w:sdtPr><w:alias w:val="Field"/><w:tag w:val="t1"/><w:text/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>Hi</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
  '<w:p><w:r><w:t>after</w:t></w:r></w:p><w:sectPr/>';

const TOC_BODY =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/>' +
  '<w:instrText xml:space="preserve"> TOC \\o "1-2" \\h </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Old entry</w:t></w:r>' +
  '<w:r><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/></w:r>' +
  '<w:r><w:t>3</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Heading</w:t></w:r></w:p><w:sectPr/>';

const PIC =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId14"/>' +
  '<a:srcRect l="0" t="0" r="0" b="0"/>' +
  '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm rot="0"><a:ext cx="152400" cy="152400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const INLINE_DRAWING =
  '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="152400" cy="152400"/><wp:docPr id="1" name="pic"/>' +
  '<wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${PIC_URI}">${PIC}</a:graphicData></a:graphic>` +
  '</wp:inline></w:drawing></w:r><w:r><w:t>x</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>y</w:t></w:r></w:p><w:sectPr/>';

const WPS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const SHAPE_DRAWING = INLINE_DRAWING.replace(
  `<a:graphicData uri="${PIC_URI}">${PIC}</a:graphicData>`,
  `<a:graphicData uri="${WPS_URI}"><wps:wsp xmlns:wps="${WPS_URI}"><wps:cNvSpPr/><wps:spPr>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/>' +
    '</a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData>'
);

const ANCHOR_DRAWING =
  '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'behindDoc="0" locked="0" relativeHeight="1" allowOverlap="1" layoutInCell="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="152400" cy="152400"/><wp:wrapSquare wrapText="bothSides"/>' +
  '<wp:docPr id="2" name="float"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${PIC_URI}">${PIC}</a:graphicData></a:graphic>` +
  '</wp:anchor></w:drawing></w:r></w:p><w:p><w:r><w:t>y</w:t></w:r></w:p><w:sectPr/>';

function listDoc(): Uint8Array {
  return zipDoc({
    body: LIST_P,
    rels: `<Relationship Id="rIdN" Type="${R}/numbering" Target="numbering.xml"/>`,
    overrides:
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    extraXml: { 'word/numbering.xml': NUMBERING },
  });
}

function linkDoc(): Uint8Array {
  return zipDoc({
    body: LINK_P,
    rels:
      `<Relationship Id="rIdH" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>` +
      `<Relationship Id="rIdH2" Type="${R}/hyperlink" Target="https://example.org" TargetMode="External"/>`,
  });
}

function drawingDoc(body: string): Uint8Array {
  return zipDoc({
    body,
    rels:
      `<Relationship Id="rId14" Type="${R}/image" Target="media/image1.png"/>` +
      `<Relationship Id="rId15" Type="${R}/image" Target="media/image2.png"/>`,
    extraBytes: { 'word/media/image1.png': PNG, 'word/media/image2.png': PNG },
  });
}

function noteDoc(): Uint8Array {
  const notes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>`;
  return zipDoc({
    body: '<w:p><w:r><w:t>Hi</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr/>',
    rels: `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>`,
    overrides:
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    extraXml: { 'word/footnotes.xml': `<w:footnotes xmlns:w="${W}">${notes}</w:footnotes>` },
  });
}

function hfDoc(secondRef: string): Uint8Array {
  return zipDoc({
    body:
      '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
      `<w:p><w:r><w:t>two</w:t></w:r></w:p><w:sectPr>${secondRef}</w:sectPr>`,
    rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    extraXml: {
      'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>H</w:t></w:r></w:p></w:hdr>`,
    },
  });
}

function story(
  kind: JournalCoverageFixture['kind'],
  bytes: Uint8Array,
  op: (store: TreePackageStore) => TreeDocOp
): JournalCoverageFixture {
  return { kind, bytes, apply: (store) => transactBody(store, op(store)) };
}

function lifecycle(
  kind: JournalCoverageFixture['kind'],
  bytes: Uint8Array,
  op: (store: TreePackageStore) => TreeDocOp
): JournalCoverageFixture {
  return {
    kind,
    bytes,
    apply: (store) => {
      const result = store.applyLifecycleOp(op(store));
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    },
  };
}

function bodyRootId(store: TreePackageStore): string {
  const story = storyRootsOf(store.bodyStore().part).find((entry) => entry.kind === 'body');
  if (!story) throw new Error('missing body');
  return story.root.id;
}

function mathDoc(): Uint8Array {
  return zipDoc({ body: MATH_P, extraXmlns: `xmlns:m="${M}"` });
}

function equationId(store: TreePackageStore): string {
  let found: string | undefined;
  walkNodes(store.bodyStore().part.root, (node) => {
    if (
      found === undefined &&
      node.kind !== 'textValue' &&
      node.namespaceUri === M &&
      node.localName === 'oMath'
    ) {
      found = node.id;
    }
  });
  if (found === undefined) throw new Error('missing equation');
  return found;
}

function drawingId(store: TreePackageStore): string {
  return findKind(store.bodyStore().part, 'drawing').id;
}

function hyperlinkId(store: TreePackageStore): string {
  return findKind(store.bodyStore().part, 'hyperlink').id;
}

function controlId(store: TreePackageStore): string {
  return contentControlsIn(store.bodyStore().part.root)[0]!.node.id;
}

export function authorableCoverageFixtures(): JournalCoverageFixture[] {
  return [
    story('replaceStoryBlocks', plainDoc(), (store) => ({
      op: 'replaceStoryBlocks',
      storyRootId: bodyRootId(store),
      paragraphs: ['Fresh', 'Next'],
    })),
    story('insertText', plainDoc(), (store) => ({
      op: 'insertText',
      paragraphId: firstParagraphId(store),
      offset: 5,
      text: '!',
    })),
    story('deleteText', plainDoc(), (store) => ({
      op: 'deleteText',
      paragraphId: firstParagraphId(store),
      start: 1,
      end: 2,
    })),
    story('setParagraphMarkRevision', plainDoc(), (store) => ({
      op: 'setParagraphMarkRevision',
      paragraphId: firstParagraphId(store),
      kind: 'ins',
      revision: QA,
    })),
    story('proposeParagraphMerge', plainDoc(), (store) => ({
      op: 'proposeParagraphMerge',
      paragraphId: paragraphIds(store)[1]!,
      revision: QA,
    })),
    story('insertCommentMarker', plainDoc(), (store) => ({
      op: 'insertCommentMarker',
      paragraphId: firstParagraphId(store),
      offset: 0,
      commentId: '1',
      marker: 'start',
    })),
    story('acceptRevision', zipDoc({ body: INS_P }), () => ({
      op: 'acceptRevision',
      revision: QA,
    })),
    story('rejectRevision', zipDoc({ body: INS_P }), () => ({
      op: 'rejectRevision',
      revision: QA,
    })),
    story('acceptAllRevisions', zipDoc({ body: INS_P }), () => ({ op: 'acceptAllRevisions' })),
    story('rejectAllRevisions', zipDoc({ body: INS_P }), () => ({ op: 'rejectAllRevisions' })),
    story(
      'setRevisionAttribution',
      zipDoc({ body: INS_P }),
      (store) => planRevisionAuthorChange(store.bodyStore().part, { author: 'Ada' }).ops[0]!
    ),
    story('insertTab', plainDoc(), (store) => ({
      op: 'insertTab',
      paragraphId: firstParagraphId(store),
      offset: 5,
    })),
    story('insertHardBreak', plainDoc(), (store) => ({
      op: 'insertHardBreak',
      paragraphId: firstParagraphId(store),
      offset: 5,
    })),
    story('insertPageBreak', plainDoc(), (store) => ({
      op: 'insertPageBreak',
      paragraphId: firstParagraphId(store),
      offset: 5,
    })),
    story('insertPageField', plainDoc(), (store) => ({
      op: 'insertPageField',
      paragraphId: firstParagraphId(store),
      offset: 5,
      field: 'PAGE',
    })),
    story('insertComplexField', plainDoc(), (store) => ({
      op: 'insertComplexField',
      paragraphId: firstParagraphId(store),
      offset: 5,
      instruction: 'REF _Ref1 \\h',
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    })),
    story('setListLevel', listDoc(), (store) => ({
      op: 'setListLevel',
      paragraphId: firstParagraphId(store),
      level: 1,
    })),
    story('setListNumbering', listDoc(), (store) => ({
      op: 'setListNumbering',
      paragraphId: paragraphIds(store)[1]!,
      numId: '1',
      level: 0,
    })),
    story('setParagraphTabStops', plainDoc(), (store) => ({
      op: 'setParagraphTabStops',
      paragraphId: firstParagraphId(store),
      stops: [{ positionTwips: 720, alignment: 'left' }],
    })),
    story('setParagraphBorders', plainDoc(), (store) => ({
      op: 'setParagraphBorders',
      paragraphId: firstParagraphId(store),
      edges: [
        { edge: 'bottom', attributes: { val: 'single', sz: '4', space: '1', color: 'auto' } },
      ],
    })),
    story('setParagraphMarkProperties', plainDoc(), (store) => ({
      op: 'setParagraphMarkProperties',
      paragraphId: firstParagraphId(store),
      properties: [{ localName: 'b' }],
    })),
    story('splitParagraph', plainDoc(), (store) => ({
      op: 'splitParagraph',
      paragraphId: firstParagraphId(store),
      offset: 2,
    })),
    story('splitParagraphMany', plainDoc(), (store) => ({
      op: 'splitParagraphMany',
      paragraphId: firstParagraphId(store),
      offsets: [1, 3],
    })),
    story('joinParagraphs', plainDoc(), (store) => {
      const ids = paragraphIds(store);
      return { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[1]! };
    }),
    story('setRunProperties', plainDoc(), (store) => ({
      op: 'setRunProperties',
      paragraphId: firstParagraphId(store),
      start: 0,
      end: 2,
      properties: [{ localName: 'b' }],
    })),
    story('setParagraphProperties', plainDoc(), (store) => ({
      op: 'setParagraphProperties',
      paragraphId: firstParagraphId(store),
      properties: [{ localName: 'jc', attributes: { val: 'center' } }],
    })),
    story('setSectionProperties', plainDoc(), () => ({
      op: 'setSectionProperties',
      orientation: 'landscape',
    })),
    story('setSectionMark', plainDoc(), (store) => ({
      op: 'setSectionMark',
      paragraphId: firstParagraphId(store),
    })),
    story(
      'insertHyperlink',
      zipDoc({
        body: TWO_P,
        rels: `<Relationship Id="rIdH" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>`,
      }),
      (store) => ({
        op: 'insertHyperlink',
        paragraphId: firstParagraphId(store),
        start: 0,
        end: 5,
        relationshipId: 'rIdH',
      })
    ),
    story('setHyperlinkTarget', linkDoc(), (store) => ({
      op: 'setHyperlinkTarget',
      linkId: hyperlinkId(store),
      relationshipId: 'rIdH2',
    })),
    story('removeHyperlink', linkDoc(), (store) => ({
      op: 'removeHyperlink',
      linkId: hyperlinkId(store),
    })),
    story('setMathEquation', mathDoc(), (store) => ({
      op: 'setMathEquation',
      equationId: equationId(store),
      linear: '{a+b}/{2}',
    })),
    story('removeMathEquation', mathDoc(), (store) => ({
      op: 'removeMathEquation',
      equationId: equationId(store),
    })),
    story('setContentControlValue', zipDoc({ body: SDT }), (store) => ({
      op: 'setContentControlValue',
      controlId: controlId(store),
      value: 'Yo',
    })),
    story('removeContentControl', zipDoc({ body: SDT }), (store) => ({
      op: 'removeContentControl',
      controlId: controlId(store),
      keepContent: true,
    })),
    story('insertInlineContentControl', plainDoc(), (store) => ({
      op: 'insertInlineContentControl',
      paragraphId: firstParagraphId(store),
      offset: 5,
      tag: 'n1',
      text: 'x',
    })),
    story('deleteBlock', plainDoc(), (store) => ({
      op: 'deleteBlock',
      blockId: firstParagraphId(store),
    })),
    story('authorTable', plainDoc(), (store) => ({
      op: 'authorTable',
      action: {
        kind: 'insert',
        paragraphId: firstParagraphId(store),
        offset: 5,
        rowCount: 2,
        columnCount: 2,
        values: [
          ['Metric', 'Value'],
          ['Coverage', '81'],
        ],
      },
    })),
    story('setTableProperties', zipDoc({ body: TABLE }), (store) => ({
      op: 'setTableProperties',
      tableId: tableIds(store).tableId,
      headerRowCount: 1,
      columnWidthsTwips: [1800, 3200],
    })),
    story(
      'setFieldCode',
      plainDoc(
        '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p><w:sectPr/>'
      ),
      (store) => ({
        op: 'setFieldCode',
        paragraphId: firstParagraphId(store),
        fieldNodeId: findKind(store.bodyStore().part, 'fldSimple').id,
        code: 'NUMPAGES',
      })
    ),
    story('insertTable', plainDoc(), (store) => ({
      op: 'insertTable',
      beforeParagraphId: paragraphIds(store)[1]!,
      rows: 2,
      cols: 2,
      columnWidthTwips: 1440,
    })),
    story(
      'moveTable',
      zipDoc({ body: `<w:p><w:r><w:t>before</w:t></w:r></w:p>${TABLE}` }),
      (store) => ({
        op: 'moveTable',
        tableId: tableIds(store).tableId,
        beforeBlockId: paragraphIds(store)[0]!,
      })
    ),
    story('insertParagraphBesideTable', zipDoc({ body: TABLE }), (store) => ({
      op: 'insertParagraphBesideTable',
      tableId: tableIds(store).tableId,
      where: 'before',
      text: 'lead',
    })),
    story('insertTableRow', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'insertTableRow',
        tableId: ids.tableId,
        rowId: ids.rowIds[0]!,
        where: 'below',
      };
    }),
    story('deleteTableRow', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return { op: 'deleteTableRow', tableId: ids.tableId, rowId: ids.rowIds[1]! };
    }),
    story('insertTableColumn', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'insertTableColumn',
        tableId: ids.tableId,
        where: 'right',
        gridColumnId: ids.gridColIds[0]!,
      };
    }),
    story('deleteTableColumn', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return { op: 'deleteTableColumn', tableId: ids.tableId, gridColumnId: ids.gridColIds[1]! };
    }),
    story('mergeTableCells', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return { op: 'mergeTableCells', tableId: ids.tableId, cellIds: ids.cellIds };
    }),
    story('splitTableCell', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'splitTableCell',
        tableId: ids.tableId,
        cellId: ids.cellIds[0]!,
        rows: 2,
        columns: 2,
      };
    }),
    story('setTableColumnWidths', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'setTableColumnWidths',
        tableId: ids.tableId,
        leftGridColumnId: ids.gridColIds[0]!,
        rightGridColumnId: ids.gridColIds[1]!,
        leftWidthTwips: 2000,
        rightWidthTwips: 3000,
      };
    }),
    story('setTableRightEdgeWidth', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'setTableRightEdgeWidth',
        tableId: ids.tableId,
        gridColumnId: ids.gridColIds[1]!,
        columnWidthTwips: 3000,
        tableWidthTwips: 5500,
      };
    }),
    story('setTableRowHeight', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'setTableRowHeight',
        tableId: ids.tableId,
        rowId: ids.rowIds[0]!,
        heightTwips: 400,
      };
    }),
    story('setTableCellBorders', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'setTableCellBorders',
        tableId: ids.tableId,
        cellIds: [ids.cellIds[0]!],
        scope: 'all',
        spec: { style: 'single', size: 8, color: { kind: 'hex', value: '000000' } },
      };
    }),
    story('setTableCellFill', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'setTableCellFill',
        tableId: ids.tableId,
        cellIds: [ids.cellIds[0]!],
        color: { kind: 'hex', value: 'FF0000' },
      };
    }),
    story('setTableCellVerticalAlignment', zipDoc({ body: TABLE }), (store) => {
      const ids = tableIds(store);
      return {
        op: 'setTableCellVerticalAlignment',
        tableId: ids.tableId,
        cellIds: [ids.cellIds[0]!],
        alignment: 'center',
      };
    }),
    lifecycle('createHeaderFooter', plainDoc(), () => ({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    })),
    lifecycle('deleteHeaderFooter', hfDoc(''), () => ({
      op: 'deleteHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    })),
    lifecycle('linkToPrevious', hfDoc('<w:headerReference w:type="default" r:id="rId7"/>'), () => ({
      op: 'linkToPrevious',
      sectionIndex: 1,
      kind: 'header',
      variant: 'default',
    })),
    lifecycle('unlinkFromPrevious', hfDoc(''), () => ({
      op: 'unlinkFromPrevious',
      sectionIndex: 1,
      kind: 'header',
      variant: 'default',
    })),
    lifecycle('setSectionFurnitureOptions', plainDoc(), () => ({
      op: 'setSectionFurnitureOptions',
      sectionIndex: 0,
      titlePage: true,
    })),
    lifecycle('setDocumentProtection', plainDoc(), () => ({
      op: 'setDocumentProtection',
      enforce: true,
    })),
    // A text watermark in a document with no header: a new header part, its relationship and
    // content type, and the watermark run, replayed as one package edit.
    lifecycle('setWatermark', plainDoc(), () => ({
      op: 'setWatermark',
      watermark: {
        kind: 'text',
        text: 'DRAFT',
        fontFamily: 'Calibri',
        fontSizePt: null,
        bold: false,
        italic: false,
        colorHex: 'C0C0C0',
        opacity: 0.5,
        diagonal: true,
        widthPt: 400,
        heightPt: 200,
      },
    })),
    lifecycle('insertNote', plainDoc(), (store) => ({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId: firstParagraphId(store),
      offset: 5,
    })),
    lifecycle('deleteNote', noteDoc(), () => ({
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 1,
    })),
    lifecycle('convertNote', noteDoc(), () => ({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    })),
    lifecycle('convertAllNotes', noteDoc(), () => ({
      op: 'convertAllNotes',
      fromKind: 'footnote',
    })),
    lifecycle('setNoteProperties', plainDoc(), () => ({
      op: 'setNoteProperties',
      scope: 'document',
      // A default value is not written where nothing authors it, so name another format.
      footnote: { numFmt: 'lowerRoman' },
    })),
    story('setContentControlProperties', zipDoc({ body: SDT }), (store) => ({
      op: 'setContentControlProperties',
      controlId: controlId(store),
      alias: 'Renamed',
    })),
    story('insertContentControl', plainDoc(), (store) => ({
      op: 'insertContentControl',
      paragraphId: firstParagraphId(store),
      start: 0,
      end: 5,
      type: 'plainText',
    })),
    {
      kind: 'insertFragment',
      bytes: plainDoc(),
      apply: (store) => {
        const fragment = zipDoc({
          body: '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BoldPaste</w:t></w:r></w:p>',
        });
        const result = store.applyFragmentPaste(
          { kind: 'body' },
          {
            paragraphId: firstParagraphId(store),
            offset: 0,
            fragmentBytes: fragment,
            lastMarkCovered: true,
          }
        );
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      },
    },
    story('insertDrawing', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'insertDrawing',
      paragraphId: paragraphIds(store)[1]!,
      offset: 1,
      drawing: parseDrawingTemplate(),
    })),
    story('replaceDrawingResource', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'replaceDrawingResource',
      drawingNodeId: drawingId(store),
      relationshipId: 'rId15',
    })),
    story('moveInlineDrawing', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'moveInlineDrawing',
      drawingNodeId: drawingId(store),
      paragraphId: paragraphIds(store)[1]!,
      offset: 1,
    })),
    story('deleteDrawing', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'deleteDrawing',
      drawingNodeId: drawingId(store),
    })),
    story('resizeDrawing', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'resizeDrawing',
      drawingNodeId: drawingId(store),
      extentEmu: { cx: 200000, cy: 200000 },
    })),
    story('cropDrawing', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'cropDrawing',
      drawingNodeId: drawingId(store),
      crop: { left: 1000, top: 2000, right: 3000, bottom: 4000 },
    })),
    story('positionDrawing', drawingDoc(ANCHOR_DRAWING), (store) => ({
      op: 'positionDrawing',
      drawingNodeId: drawingId(store),
      position: { verticalEmu: 123456, relativeToV: 'paragraph' },
    })),
    story('setDrawingWrap', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'setDrawingWrap',
      drawingNodeId: drawingId(store),
      wrap: 'square',
    })),
    story('setDrawingMetadata', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'setDrawingMetadata',
      drawingNodeId: drawingId(store),
      title: 'T',
      description: 'D',
    })),
    story('setShapeFormat', drawingDoc(SHAPE_DRAWING), (store) => ({
      op: 'setShapeFormat',
      drawingNodeId: drawingId(store),
      fill: { type: 'none' },
      outline: { color: 'FF0000', widthPt: 2 },
    })),
    story('setDrawingLocks', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'setDrawingLocks',
      drawingNodeId: drawingId(store),
      locks: { resize: true },
    })),
    story('transformDrawing', drawingDoc(INLINE_DRAWING), (store) => ({
      op: 'transformDrawing',
      drawingNodeId: drawingId(store),
      action: 'rotateCW',
    })),
    story('insertToc', zipDoc({ body: TWO_P }), (store) => ({
      op: 'insertToc',
      beforeParagraphId: firstParagraphId(store),
      instruction: ' TOC \\o "1-3" \\h ',
      alias: 'TOC',
      entries: [],
      bookmarksToCreate: [],
    })),
    story('replaceTocResult', zipDoc({ body: TOC_BODY }), (store) => {
      const toc = detectBodyTocs(store.bodyStore().part)[0]!;
      return {
        op: 'replaceTocResult',
        tocId: toc.id,
        entries: [
          {
            level: 0,
            text: 'Intro',
            headingParagraphId: paragraphIds(store)[3]!,
            bookmarkName: '_Toc1',
            pageNumberText: '2',
          },
        ],
        bookmarksToCreate: [],
      };
    }),
    story('removeToc', zipDoc({ body: TOC_BODY }), (store) => ({
      op: 'removeToc',
      tocId: detectBodyTocs(store.bodyStore().part)[0]!.id,
    })),
    story('rewriteTocPageNumbers', zipDoc({ body: TOC_BODY }), (store) => {
      const toc = detectBodyTocs(store.bodyStore().part)[0]!;
      return {
        op: 'rewriteTocPageNumbers',
        tocId: toc.id,
        updates: [{ paragraphId: toc.resultParagraphIds[0]!, pageNumberText: '9' }],
      };
    }),
    story('refreshFieldResults', zipDoc({ body: REF_FIELD_BODY }), (store) => {
      // The field anchor is the begin `w:fldChar` node — the first one in document order.
      let beginId: string | undefined;
      walkNodes(store.bodyStore().part.root, (node) => {
        if (beginId === undefined && node.kind === 'fldChar') beginId = node.id;
      });
      if (beginId === undefined) throw new Error('missing field begin fldChar');
      return {
        op: 'refreshFieldResults',
        updates: [{ paragraphId: paragraphIds(store)[1]!, fieldNodeId: beginId, text: 'new' }],
      };
    }),
    story('setFieldResult', zipDoc({ body: REF_FIELD_BODY }), (store) => {
      let beginId: string | undefined;
      walkNodes(store.bodyStore().part.root, (node) => {
        if (beginId === undefined && node.kind === 'fldChar') beginId = node.id;
      });
      if (beginId === undefined) throw new Error('missing field begin fldChar');
      return {
        op: 'setFieldResult',
        paragraphId: paragraphIds(store)[1]!,
        fieldNodeId: beginId,
        text: 'written',
      };
    }),
    story('insertEquation', plainDoc(), (store) => {
      const read = readEquationSnippet(equationPackage(`<w:r><w:t>a</w:t></w:r>${X_SQUARED}`));
      if (!read.ok) throw new Error(read.reason);
      return {
        op: 'insertEquation',
        paragraphId: firstParagraphId(store),
        offset: 2,
        nodes: read.snippet.nodes,
        length: read.snippet.length,
        revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
      };
    }),
    story(
      'setTextFormFieldDefault',
      zipDoc({
        body: '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="InputA"/><w:textInput><w:default w:val="Old"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Old</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr/>',
      }),
      (store) => {
        let fieldNodeId: string | undefined;
        walkNodes(store.bodyStore().part.root, (node) => {
          if (fieldNodeId === undefined && node.kind === 'fldChar') fieldNodeId = node.id;
        });
        if (!fieldNodeId) throw new Error('missing text form');
        return {
          op: 'setTextFormFieldDefault',
          paragraphId: firstParagraphId(store),
          fieldNodeId,
          text: 'New',
        };
      }
    ),
    story(
      'commitTextFormField',
      zipDoc({
        body: '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="InputA"/><w:textInput><w:default w:val="Old"/><w:format w:val="Uppercase"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Old</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr/>',
      }),
      (store) => {
        let fieldNodeId: string | undefined;
        walkNodes(store.bodyStore().part.root, (node) => {
          if (fieldNodeId === undefined && node.kind === 'fldChar') fieldNodeId = node.id;
        });
        if (!fieldNodeId) throw new Error('missing text form');
        return {
          op: 'commitTextFormField',
          paragraphId: firstParagraphId(store),
          fieldNodeId,
        };
      }
    ),
    story(
      'setLegacyCheckbox',
      zipDoc({
        body: '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Box"/><w:checkBox><w:size w:val="24"/><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr/>',
      }),
      (store) => {
        let fieldNodeId: string | undefined;
        walkNodes(store.bodyStore().part.root, (node) => {
          if (fieldNodeId === undefined && node.kind === 'fldChar') fieldNodeId = node.id;
        });
        if (!fieldNodeId) throw new Error('missing checkbox form');
        return {
          op: 'setLegacyCheckbox',
          paragraphId: firstParagraphId(store),
          fieldNodeId,
          checked: true,
        };
      }
    ),
    story(
      'setLegacyDropdown',
      zipDoc({
        body: '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Box"/><w:ddList><w:result w:val="0"/><w:listEntry w:val="Red"/><w:listEntry w:val="Green"/></w:ddList></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr/>',
      }),
      (store) => {
        let fieldNodeId: string | undefined;
        walkNodes(store.bodyStore().part.root, (node) => {
          if (fieldNodeId === undefined && node.kind === 'fldChar') fieldNodeId = node.id;
        });
        if (!fieldNodeId) throw new Error('missing checkbox form');
        return {
          op: 'setLegacyDropdown',
          paragraphId: firstParagraphId(store),
          fieldNodeId,
          selectedIndex: 1,
        };
      }
    ),
    story(
      'insertBookmark',
      zipDoc({ body: '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>' }),
      (store) => {
        const paragraphId = firstParagraphId(store);
        return {
          op: 'insertBookmark',
          name: 'Greeting',
          start: { paragraphId, offset: 6 },
          end: { paragraphId, offset: 11 },
        };
      }
    ),
    story(
      'deleteBookmark',
      zipDoc({
        body: '<w:p><w:bookmarkStart w:id="1" w:name="Greeting"/><w:r><w:t>Hello</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:sectPr/>',
      }),
      () => ({ op: 'deleteBookmark', name: 'greeting' })
    ),
    story(
      'insertBuildingBlock',
      zipDoc({
        body:
          '<w:sdt><w:sdtPr><w:id w:val="7"/><w:showingPlcHdr/><w:docPartList><w:docPartGallery w:val="Quick Parts"/></w:docPartList></w:sdtPr>' +
          '<w:sdtContent><w:p><w:r><w:t>Choose a building block.</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
          '<w:p><w:r><w:t>after</w:t></w:r></w:p><w:sectPr/>',
      }),
      (store) => ({
        op: 'insertBuildingBlock',
        controlId: findKind(store.bodyStore().part, 'contentControl').id,
        name: 'Approval',
        blocks: [
          findKind(parseBodyPart('<w:p><w:r><w:t>Approved by</w:t></w:r></w:p>'), 'paragraph'),
        ],
      })
    ),
  ];
}

/** A throwaway part whose body holds `xml`, for op payloads that carry foreign blocks. */
function parseBodyPart(xml: string): OoxmlPart {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${xml}</w:body></w:document>`,
    { name: '/word/payload.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

// Shared footnote/endnote assembly for browser and headless layout.

import {
  relationshipTargetIn,
  type HeadlessDocumentView,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  authoredDocumentEndnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../store/package/note-properties.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { DocumentLinkProjectors } from './document-link-projector.ts';
import { layoutHeaderFooterStory } from './hf-layout.ts';
import { enumerateDocumentSectionsBounded, sectionLineGridPt } from './section-properties.ts';
import type { NotesLayoutInput } from './note-pagination.ts';
import {
  bodySectionNode,
  paragraphSectionNode,
  sectionPropertiesNodes,
} from './section-properties.ts';
import { storyBlocks } from './story-roots.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';

/** Inputs for projecting notes through the same semantic layout pass. @public */
export interface CreateDocumentNotesInputOptions {
  readonly view: HeadlessDocumentView;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: Parameters<typeof layoutHeaderFooterStory>[4];
  readonly styleCascade?: () => StyleCascadeTable | undefined;
  readonly numberingIndex?: () => NumberingIndex;
  readonly defaultTabStopPt?: number;
  readonly compatibilityMode?: number;
  readonly inlineDrawingLayoutForPart?: (
    partName: string
  ) => InlineDrawingLayoutContext | undefined;
  readonly drawingTokenForParagraphForPart?: (partName: string, paragraph: OoxmlNode) => string;
  readonly drawingLayoutEpochForPart?: (partName: string) => string;
  /** Link/property projection and its inseparable cache identities. */
  readonly linkProjectors: DocumentLinkProjectors;
  readonly projectFieldLink?: NotesLayoutInput['projectFieldLink'];
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
}

function sectionPropertyNodes(
  part: OoxmlPart,
  sections: ReturnType<typeof enumerateDocumentSectionsBounded>['sections'],
  truncated: boolean,
  displayMode?: RevisionDisplayMode,
  revisionAuthorFilter?: RevisionAuthorFilter
): readonly (OoxmlElement | undefined)[] {
  const blocks = storyBlocks(part, displayMode, revisionAuthorFilter);
  if (!truncated) return sectionPropertiesNodes(part, blocks, sections);
  // The last section's properties are the body's own w:sectPr, not a paragraph's.
  const body = bodySectionNode(part);
  const final =
    body !== undefined && body.kind !== 'textValue' ? (body as OoxmlElement) : undefined;
  const nodes: (OoxmlElement | undefined)[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const section = paragraphSectionNode(block);
    if (section) nodes.push(section);
  }
  while (nodes.length < sections.length) nodes.push(undefined);
  if (nodes.length > 0 && nodes[nodes.length - 1] === undefined) nodes[nodes.length - 1] = final;
  return nodes;
}

/** Build note layout input from the neutral package view, or undefined when unused. @public */
export function createDocumentNotesInput(
  options: CreateDocumentNotesInputOptions
): NotesLayoutInput | undefined {
  const pkg = options.view.currentPackage();
  const footnotesPart = resolveNotesPart(pkg, 'footnote');
  const endnotesPart = resolveNotesPart(pkg, 'endnote');
  if (!footnotesPart && !endnotesPart) return undefined;
  const body = options.view.part();
  if (collectNoteReferences(body).length === 0) return undefined;

  // settings.xml contributes only the endnote position; numbering is per section.
  const endnoteAuthored = authoredDocumentEndnoteProperties(settingsPartOf(pkg));
  const documentFootnoteProps = resolveFootnoteProperties();
  const documentEndnoteProps = resolveEndnoteProperties(undefined, endnoteAuthored);
  const enumeration = enumerateDocumentSectionsBounded(
    body,
    options.displayMode,
    options.revisionAuthorFilter
  );
  const sectionNodes = sectionPropertyNodes(
    body,
    enumeration.sections,
    enumeration.truncated,
    options.displayMode,
    options.revisionAuthorFilter
  );
  const footnotePropsBySection = enumeration.sections.map((_, index) =>
    resolveFootnoteProperties(authoredFootnotePropertiesFromSectPr(sectionNodes[index]))
  );
  const endnotePropsBySection = enumeration.sections.map((_, index) =>
    resolveEndnoteProperties(
      authoredEndnotePropertiesFromSectPr(sectionNodes[index]),
      endnoteAuthored
    )
  );

  const drawingsForPart = options.inlineDrawingLayoutForPart
    ? (partName: string) => {
        const inlineDrawingLayout = options.inlineDrawingLayoutForPart!(partName);
        if (!inlineDrawingLayout) return undefined;
        return {
          inlineDrawingLayout,
          ...(options.drawingTokenForParagraphForPart
            ? {
                drawingTokenForParagraph: (paragraph: OoxmlNode) =>
                  options.drawingTokenForParagraphForPart!(partName, paragraph),
              }
            : {}),
        };
      }
    : undefined;

  const noteParts = [footnotesPart, endnotesPart];
  return {
    footnotesPart,
    endnotesPart,
    footnotePropsBySection:
      footnotePropsBySection.length > 0 ? footnotePropsBySection : [documentFootnoteProps],
    endnotePropsBySection:
      endnotePropsBySection.length > 0 ? endnotePropsBySection : [documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer: options.measurer,
    producer: options.producer,
    cache: options.cache,
    styleCascade: options.styleCascade?.(),
    numberingIndex: options.numberingIndex?.(),
    lineGridPitchBySection: enumeration.sections.map((section) =>
      sectionLineGridPt(section.properties)
    ),
    defaultTabStopPt: options.defaultTabStopPt,
    compatibilityMode: options.compatibilityMode,
    displayMode: options.displayMode,
    revisionAuthorFilter: options.revisionAuthorFilter,
    projectLinkForPart: options.linkProjectors.projectLinkForPart,
    linkRelsEpoch: noteParts
      .map((part) => (part ? options.linkProjectors.epochForPart(part.name) : ''))
      .join('\0'),
    ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
    showFieldCodes: options.showFieldCodes,
    projectionTokenForParagraphForPart: options.linkProjectors.tokenForParagraphForPart,
    projectionTokenForTableForPart: options.linkProjectors.tokenForTableForPart,
    projectionEpoch: noteParts
      .map((part) => (part ? options.linkProjectors.epochForPart(part.name) : ''))
      .join('\0'),
    ...(drawingsForPart ? { drawingsForPart } : {}),
    ...(drawingsForPart && options.drawingLayoutEpochForPart
      ? {
          drawingLayoutEpoch: noteParts
            .map((part) => (part ? options.drawingLayoutEpochForPart!(part.name) : ''))
            .join('\0'),
        }
      : {}),
  };
}

/** Resolve a relationship in a non-body story for shared link projection. @public */
export function documentRelationshipTargetIn(
  view: HeadlessDocumentView,
  partName: string,
  relationshipId: string
): ReturnType<typeof relationshipTargetIn> {
  return relationshipTargetIn(view.currentPackage(), partName, relationshipId);
}

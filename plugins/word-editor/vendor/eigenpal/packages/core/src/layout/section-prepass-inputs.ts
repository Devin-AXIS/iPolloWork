import type { SectionPrepass } from './section-prepass-types.ts';

type Inputs = Pick<
  SectionPrepass,
  | 'framePolicy'
  | 'producer'
  | 'contentWidth'
  | 'styleCascade'
  | 'numberingIndex'
  | 'tocToken'
  | 'refToken'
> & { drawingEpoch: string | null; projectionEpoch: string | null };

/** List maps compare separately; each prepared table key includes its own list tokens. */
export function sectionPrepassInputsMatch(
  previous: SectionPrepass | null | undefined,
  next: Inputs
): previous is SectionPrepass {
  return (
    previous != null &&
    next.drawingEpoch !== null &&
    next.projectionEpoch !== null &&
    previous.framePolicy === next.framePolicy &&
    previous.drawingEpoch === next.drawingEpoch &&
    previous.projectionEpoch === next.projectionEpoch &&
    previous.producer === next.producer &&
    previous.contentWidth === next.contentWidth &&
    previous.styleCascade === next.styleCascade &&
    previous.numberingIndex === next.numberingIndex &&
    previous.tocToken === next.tocToken &&
    previous.refToken === next.refToken
  );
}

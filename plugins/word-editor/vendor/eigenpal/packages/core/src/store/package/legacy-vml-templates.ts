import { readOoxmlPart, type OoxmlElement } from './ooxml-tree.ts';
import { attribute, children, OFFICE, VML } from './legacy-vml-values.ts';

// Namespace-aware signatures of the standard Office templates already in the
// watermark-picture.docx (t75) and watermark-confidential.docx (t136) fixtures, and the text box
// template (t202).
// Matching only the type id would silently discard custom formulas/geometry.
const sources = [
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>',
  // The picture frame template without its formulas. They only inset the frame path by a drawn
  // outline's width; a picture frame draws no outline, so the picture fills the same box.
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>',
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@9,21600;@11,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>',
  // The text path template a desktop-authored text watermark carries.
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>',
  '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>',
  '<v:shapetype id="_x0000_t32" coordsize="21600,21600" o:spt="32" o:oned="t" path="m,l21600,21600e" filled="f"><v:path arrowok="t" fillok="f" o:connecttype="none"/></v:shapetype>',
];
function signature(node: OoxmlElement): string {
  return JSON.stringify([
    node.namespaceUri,
    node.localName,
    node.attributes
      .map((a) => [a.namespaceUri ?? '', a.localName, a.value.trim().replace(/\s+/g, ' ')])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    // An editing lock never changes the geometry, so writers that add one still match.
    children(node)
      .filter((child) => !(child.namespaceUri === OFFICE && child.localName === 'lock'))
      .map(signature),
  ]);
}
let signatures: ReadonlySet<string> | undefined;
export function isStandardVmlTemplate(node: OoxmlElement): boolean {
  if (!signatures)
    signatures = new Set(
      sources.map((source) => {
        const parsed = readOoxmlPart(
          `<root xmlns:v="${VML}" xmlns:o="${OFFICE}">${source}</root>`,
          { name: '/template.xml', contentType: 'application/xml' }
        );
        if (!parsed.ok) throw new Error('Invalid built-in VML template');
        return signature(children(parsed.part.root)[0]!);
      })
    );
  return (
    ['_x0000_t75', '_x0000_t32', '_x0000_t136', '_x0000_t202'].includes(
      attribute(node, 'id') ?? ''
    ) && signatures.has(signature(node))
  );
}

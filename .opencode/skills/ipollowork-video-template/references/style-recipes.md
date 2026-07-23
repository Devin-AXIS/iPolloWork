# Style recipes

Treat style as a coherent system of typography, spacing, palette, texture, composition, and motion. Do not implement a style by changing only the accent color.

| Style | Typography and layout | Palette and texture | Motion |
| --- | --- | --- | --- |
| minimal | restrained sans, large whitespace, few elements | neutral base, one accent | fades, short slides, low intensity |
| swiss | grotesk type, strict grid, asymmetric alignment | white/red/black or similarly disciplined palette | grid reveals, hard cuts, precise wipes |
| editorial | display serif plus clean sans, image-led hierarchy | paper-like neutrals, rich photography | measured pans, masks, chapter pacing |
| newsprint | serif headlines, columns, labels and rules | ink, off-white paper, halftone | print-in reveals, restrained jitter |
| bold | oversized type, dense framing, high contrast | saturated primary blocks | decisive scale, snap, hard transitions |
| soft/pastel | rounded type, generous spacing, cards | low-contrast warm or pastel fields | float, dissolve, gentle spring |
| glass | clean sans, layered panels and depth | translucent surfaces, controlled glow | depth shifts, blur-to-sharp, parallax |
| dark | luminous hierarchy on deep background | near-black base, limited bright accents | slow reveals, restrained glow |
| cyber | mono labels, technical grid, sharp type | dark base, cyan/magenta or signal colors | glitch bursts, scan, cursor, quick cuts |
| technical | mono annotations, diagrams, measured grid | neutral or dark engineering palette | tracing, step reveals, precise indicators |
| cinematic | large type, image or 3D staging, deep composition | graded darks, selective highlights, grain | camera movement, light sweeps, longer easing |
| data | legible sans, numeric hierarchy, chart-first layout | neutral base with semantic highlights | count-up, bar growth, annotation sequence |
| playful | expressive type, irregular but intentional layout | lively multi-color palette | bounce, squash, stagger, surprising transitions |
| brutalist | raw type, visible borders, abrupt hierarchy | stark black/white plus warning accent | hard cuts, immediate movement, little easing |
| retro | era-specific display type and geometry | limited period palette, noise or raster texture | stepped movement, analog flicker, wipes |
| sketch | handwritten accents, diagram composition | paper, graphite, one marker color | draw-on paths, annotation reveals |
| custom | derive rules from the supplied reference | document the chosen token system | document one primary and one secondary motion rule |

## Style selection rules

- Match the audience and story before novelty.
- Keep text contrast and caption readability higher than stylistic texture.
- Use the same visual tokens across scenes.
- Keep a single dominant type system and motion language.
- Give WebGL, grain, blur, particles, and glow a static fallback.
- Respect an imported template's identity unless the user explicitly requests restyling.
- When translating a reference style, reproduce its principles rather than copying protected logos, characters, or proprietary assets.

## Required style output

Before implementation, state:

```text
Style:
Palette:
Display/body/mono typography:
Grid and spacing:
Primary motion:
Secondary motion:
Texture:
Fallback:
```

Map public style choices to declared manifest variables. Keep structural layout math and effect internals locked.

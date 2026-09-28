# Kinetic Type

Use when language itself is the main visual subject and changes in wording, emphasis, scale, or composition carry the story. Do not apply kinetic type to long paragraphs or decorative background copy.

## Semantic roles

- `[data-motion-role="phrase"]` — one short readable language unit.
- `[data-motion-role="keyword"]` — the word whose emphasis changes meaning.
- `[data-motion-role="qualifier"]` — compact context that modifies the phrase.
- `[data-motion-role="punctuation"]` — an optional timing or tonal cue.
- `[data-motion-role="resolve"]` — the final complete statement.

## Registry candidates

Prefer `kinetic-keyword`, `narrative-hook`, `brand-headline`, `brand-manifesto`, `quote-pullout`, `pull-quote`, `definition-highlight`, `chapter-countdown`, or `section-marker`. Use the component's typography and theme; do not replace it with generic oversized text.

## Beat grammar

- **Establish:** reveal the first complete phrase with a stable reading baseline.
- **Develop:** replace, accumulate, or transform keywords at semantic stress points.
- **Land:** assemble or hold the final statement without continuing decorative motion.

## Execution contract

Break copy at meaning boundaries, not arbitrary word counts. One emphasis event corresponds to one spoken stress, contrast, correction, or conclusion. Call `list_motion_presets` and prefer text-specific presets such as highlight sweep, weight shift, kinetic slam, shiny sweep, or true focus; apply the chosen preset with `mutate_motion` and retain its animation reference.

Keep phrases short enough to read before the next change. Preserve line breaks needed for the final composition. Avoid per-character motion for body copy, simultaneous motion on every line, and loops that continue after the meaning lands.

## Acceptance

- Text remains readable at Establish, every semantic change, and Land checkpoints.
- Emphasis follows source meaning and narration order.
- The final statement is complete and holds long enough to understand.
- Removing motion would remove part of the intended temporal meaning; otherwise use a quieter pattern.

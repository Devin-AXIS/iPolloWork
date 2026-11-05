# Core Video Scene Contract

The library owns scene-body fragments. The active session owns the composition root, stage, timeline, tracks, media sequencing and editor contract; the active template owns visual identity.

- Each file contains one `template[data-ipw-layout]` with `data-layout-description` and `data-layout-capacity`, semantic `data-slot` targets, and a matching scoped `style[data-layout-styles]`.
- Copy the fragment and needed scoped styles only, including the `.ipw-video-layout` baseline. Omit preview hosts, `:root` tokens and scripts. Keep the project's existing token stylesheet and semantic variables.
- Insert inside the existing supported scene wrapper. Do not duplicate a root composition, create a second timeline or inherit a duration from this reference.
- Allocate unique IDs for repeated scene instances and scope animation selectors. Preserve existing supported `data-start`, `data-duration`, clip/track attributes and update all dependent timing together when edits require it.
- Static bodies start readable. Add deterministic entrance/exit states through the actual project timeline; verify direct seek, reverse seek and replay before delivery.
- Supply real saved media with correct sizing/crops. Do not add autoplay, hidden muted media, audio nodes or placeholder asset URLs merely to make a fragment look complete.
- Counts and layout slots do not determine frame rate, scene duration or narration. Follow the active runtime and video rules for those decisions.

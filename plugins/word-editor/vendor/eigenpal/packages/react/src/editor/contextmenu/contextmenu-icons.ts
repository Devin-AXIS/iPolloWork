// Icon path data for the context menu's own command rows.
//
// PATHS, not components, because that is the vocabulary the menu rows already speak:
// `MenuRow` takes rendered icon content and every packaged row feeds it `chromeIcon(paths)`
// from the chrome registry. Matching that keeps one icon shape across both panels.
//
// They live here rather than in the registry because none of these is a chrome slot — the
// registry describes toolbar and menu-bar controls, and adding entries for rows nothing
// renders in either would put dead controls in the default arrangement. They live here
// rather than in `components/ui/Icons.tsx` because that file is at its 1000-line cap and
// exports React components, which is the other vocabulary.
//
// Material Symbols (Google, Apache-2.0), viewBox "0 -960 960 960", the same family and box
// as `GENERATED_ICON_PATHS`. Glyph names are given so a future icon sweep can find them.

/** `content_cut` */
export const CUT_PATHS: readonly string[] = [
  'M760-120 480-400l-94 94q8 15 11 32t3 34q0 66-47 113T240-80q-66 0-113-47T80-240q0-66 47-113t113-47q17 0 34 3t32 11l94-94-94-94q-15 8-32 11t-34 3q-66 0-113-47T80-720q0-66 47-113t113-47q66 0 113 47t47 113q0 17-3 34t-11 32l494 494v40H760ZM600-560l-80-80 240-240h120v40L600-560ZM240-640q33 0 56.5-23.5T320-720q0-33-23.5-56.5T240-800q-33 0-56.5 23.5T160-720q0 33 23.5 56.5T240-640Zm240 180q8 0 14-6t6-14q0-8-6-14t-14-6q-8 0-14 6t-6 14q0 8 6 14t14 6Zm-240 300q33 0 56.5-23.5T320-240q0-33-23.5-56.5T240-320q-33 0-56.5 23.5T160-240q0 33 23.5 56.5T240-160Z',
];

/** `content_copy` */
export const COPY_PATHS: readonly string[] = [
  'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z',
];

/** `content_paste` */
export const PASTE_PATHS: readonly string[] = [
  'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h168q13-36 43.5-58t68.5-22q38 0 68.5 22t43.5 58h168q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560h-80v120H280v-120h-80v560Zm280-560q17 0 28.5-11.5T520-800q0-17-11.5-28.5T480-840q-17 0-28.5 11.5T440-800q0 17 11.5 28.5T480-760Z',
];

/** `delete` — the same glyph the registry's `delete` carries, kept beside its siblings. */
export const DELETE_PATHS: readonly string[] = [
  'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z',
];

/** `toc` — the same glyph the Insert menu's table-of-contents slot carries. */
export const REFRESH_TOC_PATHS: readonly string[] = [
  'M120-240v-80h240v80H120Zm0-200v-80h480v80H120Zm0-200v-80h720v80H120Z',
];

/** `format_list_numbered` — numbers beside rows, which is what this row refreshes. */
export const REFRESH_TOC_PAGE_NUMBERS_PATHS: readonly string[] = [
  'M120-80v-60h100v-30h-60v-60h60v-30H120v-60h120q17 0 28.5 11.5T280-280v40q0 17-11.5 28.5T240-200q17 0 28.5 11.5T280-160v40q0 17-11.5 28.5T240-80H120Zm0-280v-110q0-17 11.5-28.5T160-510h60v-30H120v-60h120q17 0 28.5 11.5T280-560v70q0 17-11.5 28.5T240-450h-60v30h100v60H120Zm60-280v-180h-60v-60h120v240h-60Zm180 440v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360Z',
];

/** `select_all` */
export const SELECT_ALL_PATHS: readonly string[] = [
  'M280-280v-400h400v400H280Zm80-80h240v-240H360v240ZM200-120q-33 0-56.5-23.5T120-200h80v80Zm-80-160v-80h80v80h-80Zm0-160v-80h80v80h-80Zm0-160v-80h80v80h-80Zm0-160q0-33 23.5-56.5T200-840v80h-80Zm160 640v-80h80v80h-80Zm0-640v-80h80v80h-80Zm160 640v-80h80v80h-80Zm0-640v-80h80v80h-80Zm160 640v-80h80v80h-80Zm0-640v-80h80v80h-80Zm160 640v-80h80q0 33-23.5 56.5T760-120Zm0-160v-80h80v80h-80Zm0-160v-80h80v80h-80Zm0-160v-80h80v80h-80Zm0-160v-80q33 0 56.5 23.5T840-760h-80Z',
];

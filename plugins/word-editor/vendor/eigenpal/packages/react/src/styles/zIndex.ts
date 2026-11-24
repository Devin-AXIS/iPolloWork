/**
 * Z-index stacking order for editor chrome.
 *
 * Single source of truth so layered UI doesn't drift into ad-hoc numbers.
 *
 * Order, low to high:
 *   page content (default 0)
 *   HF inline editor      — sits above page content, below chrome
 *   ruler                 — must stay readable when HF editor is active
 *   outline               — floating toggle + panel beside the page
 *   dropdown / popover    — opens from toolbar buttons or HF options
 *   toolbar               — title bar + formatting bar
 *   context menu / modal  — top-most, transient surfaces
 */
export const Z_INDEX = {
  hfInlineEditor: 10,
  /** Notes / transient chrome banners above the page, below dropdowns. */
  chrome: 50,
  ruler: 30,
  outline: 40,
  dropdown: 100,
  /** Alias for tooltip / hover preview surfaces. */
  popover: 100,
  toolbar: 100,
  contextMenu: 10000,
  /** Alias for dialogs that sit with context menus. */
  modal: 10000,
} as const;

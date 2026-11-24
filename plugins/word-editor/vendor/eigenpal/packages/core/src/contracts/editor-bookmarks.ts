/**
 * Which kind of story a bookmark is in: the main text, a header or footer, or a note.
 *
 * @public
 */
export type BookmarkStory = 'body' | 'headerFooter' | 'note';

/**
 * Where a bookmark is, finer than {@link BookmarkStory}: the main text, a header, a footer, a
 * footnote or an endnote.
 *
 * @public
 */
export type BookmarkPlace = 'body' | 'header' | 'footer' | 'footnote' | 'endnote';

/**
 * One bookmark, as the `bookmarks` query lists it.
 *
 * @public
 */
export interface BookmarkSummary {
  /** The name as the document writes it. Names compare without case. */
  readonly name: string;
  /** Whether the name starts with an underscore. Hidden bookmarks mark application targets. */
  readonly hidden: boolean;
  /** The story the bookmark starts in. */
  readonly story: BookmarkStory;
  /** The same story, telling a header from a footer and a footnote from an endnote. */
  readonly place: BookmarkPlace;
  /**
   * Position in document order: the main text first, then headers, footers and notes. Sort by
   * this value to list bookmarks by location.
   */
  readonly order: number;
  /** Whether the bookmark marks a point rather than a range of text. */
  readonly empty: boolean;
  /** Whether the start of the selection is inside the bookmark, edges included. */
  readonly atSelection: boolean;
  /**
   * How many other places carry the same name. Usually 0. Collaborators who add one name while
   * offline can leave copies; the list, Go To and links use this bookmark, the first in
   * document order. Adding the name again at this bookmark keeps it and removes the copies.
   */
  readonly duplicates: number;
}

/**
 * The bookmark commands an editor accepts.
 *
 * @public
 */
export interface EditorBookmarkCommands {
  /**
   * Bookmark the selection under `name`, or the caret position when the selection is
   * collapsed. A bookmark that already has the name, compared without case, moves here, also
   * from another story, in one undo step. Two collaborators who add one name offline both keep
   * their bookmark; every replica reads the first in document order until the next write of the
   * name, which replaces or removes both.
   * Refused with `invalidArgs` for a name that does not start with a letter, holds a
   * character other than a letter, a digit or an underscore, or has more than 40 characters.
   */
  insertBookmark: { name: string };
  /**
   * Remove the bookmark with this name, compared without case, and any copies of it in other
   * places. The text stays.
   */
  deleteBookmark: { name: string };
  /**
   * Keep the bookmark this name means, the first in document order, and remove its copies, in
   * one undo step. The selection does not move. Collaborators who add one name while offline
   * can leave copies; `BookmarkSummary.duplicates` counts them. Refused with `notFound` when no
   * bookmark has the name, and with `unsupported` when it has no copies.
   */
  keepFirstBookmark: { name: string };
  /** Select the bookmark's text, or put the caret at a point bookmark, and scroll to it. */
  goToBookmark: { name: string };
  /** Show or hide bracket marks at bookmarks. A view command: the document does not change. */
  toggleBookmarks: Record<never, never>;
  /**
   * Open the host's Go To UI, the Go to tab of `DocxEditor.Navigation`, the request its
   * shortcut (Ctrl+G, Cmd+Option+G on macOS) sends. Allowed in a read-only document. Refused
   * with `unsupported` while no host shows one. To jump without UI, run `goToBookmark`.
   *
   * `fromShortcut: true` asks as the shortcut does: also refused with `unsupported` when the
   * Go To UI turned its shortcut off (`GoToChromeHandlers.shortcut`). Chrome that forwards the
   * chord sends it, and a menu asks `can` with it before it shows the shortcut.
   */
  openGoTo: { readonly fromShortcut?: boolean };
  /**
   * Open the Bookmark dialog the host registered, the same request the Insert menu and
   * Ctrl/Cmd+Shift+F5 send. Allowed in a read-only document, where Go To still works.
   * Refused with `unsupported` while no host shows a bookmark dialog, for example when the
   * `bookmark` popup is `false`.
   */
  openBookmarkDialog: Record<never, never>;
}

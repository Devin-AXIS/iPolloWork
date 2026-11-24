import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

/** Shared review controls for the React and Vue formatting bars. */
export const REVIEW_CHROME_GROUP = {
  id: 'review',
  labelKey: 'formattingBar.commentsAndChanges',
  controls: [
    {
      // Packaged in the Review menu; hosts may compose a shortcut.
      id: 'revisionMarkup',
      shape: 'icon',
      labelKey: 'revisionMarkup.title',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['edit_note'],
      state: { kind: 'command' },
    },
    {
      id: 'simpleMarkup',
      shape: 'icon',
      labelKey: 'review.simpleMarkup',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'allMarkup',
      shape: 'icon',
      labelKey: 'review.allMarkup',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'noMarkup',
      shape: 'icon',
      labelKey: 'review.noMarkup',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'original',
      shape: 'icon',
      labelKey: 'review.original',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'previousChange',
      shape: 'icon',
      labelKey: 'review.previousChange',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['keyboard_arrow_up'],
      state: { kind: 'command' },
    },
    {
      id: 'nextChange',
      shape: 'icon',
      labelKey: 'review.nextChange',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['keyboard_arrow_down'],
      state: { kind: 'command' },
    },
    {
      id: 'acceptAllChanges',
      shape: 'icon',
      labelKey: 'review.acceptAllChanges',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['check'],
      state: { kind: 'command' },
    },
    {
      id: 'rejectAllChanges',
      shape: 'icon',
      labelKey: 'review.rejectAllChanges',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['close'],
      state: { kind: 'command' },
    },
    {
      id: 'paragraphMarks',
      shape: 'icon',
      labelKey: 'formattingBar.paragraphMarks',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['format_paragraph'],
      state: { kind: 'command' },
    },
    {
      // Bracket marks at bookmarks; presentation only, like paragraph marks.
      id: 'bookmarks',
      shape: 'icon',
      labelKey: 'formattingBar.showBookmarks',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['bookmarks'],
      state: { kind: 'command' },
    },
    {
      // Word's Protect Document (Restrict Editing on Windows), reduced to the one restriction
      // this row applies: filling in forms. The label says so, because the row offers no
      // choice of restriction and one click makes ordinary prose untypable. Pressed while the
      // document enforces a protection; a document edit, undoable.
      id: 'protectDocument',
      shape: 'icon',
      labelKey: 'review.protectDocument',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['lock'],
      state: { kind: 'command' },
    },
    {
      // Packaged in the Review menu: records a revised document's differences in the open one
      // as tracked changes. Requires the review module.
      id: 'compareDocuments',
      shape: 'icon',
      labelKey: 'review.compareDocuments',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['difference'],
      state: { kind: 'command' },
    },
    {
      id: 'comments',
      shape: 'icon',
      labelKey: 'formattingBar.commentsAndChanges',
      paths: GENERATED_ICON_PATHS['comment'],
      state: { kind: 'command' },
    },
    {
      // Starts a comment draft on the selection in the review rail. Not in the default bar:
      // `comments` above is the pane toggle. The engine answers whether a comment could be
      // added here; the adapter's review rail opens the draft.
      id: 'addComment',
      shape: 'icon',
      labelKey: 'formattingBar.addComment',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['add_comment'],
      state: { kind: 'command' },
    },
    {
      // Packaged under Review > Markup Options > Reviewers; hosts may compose a shortcut.
      id: 'authors',
      shape: 'dropdown',
      labelKey: 'reviewers.label',
      paths: GENERATED_ICON_PATHS['visibility'],
      defaultToolbar: false,
      state: { kind: 'command' },
    },
    {
      // The "✎ Editing ▾" mode pill: icon + current-mode label + caret.
      id: 'editingMode',
      shape: 'dropdown',
      labelKey: 'editingMode.label',
      valueKey: 'editingMode.editing',
      paths: GENERATED_ICON_PATHS['edit_note'],
      state: { kind: 'command' },
    },
  ],
} as const;

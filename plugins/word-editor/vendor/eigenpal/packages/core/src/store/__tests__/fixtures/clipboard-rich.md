# Rich clipboard fixture

`clipboard-rich.docx` freezes the repository's demo document before its DrawingML showcase expansion.

The clipboard tests use this fixed document to cover styles, numbering, merged tables, content controls, notes, bookmarks, and image relationships. Its content fits the supported clipboard subset. Tests also check that the live demo document reports an explicit refusal when a selection includes charts.

Keep this fixture independent of changes to the public demo document.

# Faithful Task 2A Report

## Scope

Implemented the shared, reversible structured text DOM materializer in Core only.

## Delivered

- `materializeStructuredText` builds `unit/background/text` layers without `innerHTML`.
- `snapshotStructuredText` and `restoreStructuredText` preserve the original node objects and target attributes for preview cleanup.
- `unwrapStructuredText` restores the source marker exactly for persistent removal.
- Word materialization keeps whitespace as text nodes and appends trailing punctuation to the preceding text layer.
- Decorative per-unit layers are empty and `aria-hidden`, preventing duplicate `textContent`.

## Verification

- Focused DOM tests.
- Existing structured motion tests.
- Core build.
- `git diff --check`.

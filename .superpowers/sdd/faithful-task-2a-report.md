# Faithful Task 2A Report

## Scope

Implemented the shared, reversible structured text DOM materializer in Core only.

## Delivered

- `materializeStructuredText` builds `unit/background/text` layers without `innerHTML`.
- `snapshotStructuredText` and `restoreStructuredText` preserve the original node objects and target attributes for preview cleanup.
- `unwrapStructuredText` restores the source marker exactly for persistent removal.
- Word materialization keeps whitespace as text nodes and appends trailing punctuation to the preceding text layer.
- Word, character, and whole splits use only their compatible legacy marker.
- The legacy Highlight recipe restores its `0.075em 0.15em 0.1em` unit padding and `line-height: 1`.
- Clone layers carry the unit text and remain `aria-hidden`; the encoded source marker remains authoritative.
- Particle specs materialize under their owning unit/container with finite data and inline positioning values.
- Existing source markers take priority over caller text during repeated materialization.

## Verification

Run from `vendor/hyperframes/packages/core`:

```powershell
bun.cmd x vitest run src/structuredTextDom.test.ts src/structuredTextMotion.test.ts src/motionPresets.test.ts
bun.cmd run build
```

Run from the repository root:

```powershell
git diff --check
```

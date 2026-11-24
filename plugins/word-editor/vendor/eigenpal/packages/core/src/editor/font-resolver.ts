// Moved to the layout lane so the headless export composition root can call it without a
// grandfathered lane edge; this shim keeps the editor-internal import paths stable.
export * from '../layout/font-resolver.ts';

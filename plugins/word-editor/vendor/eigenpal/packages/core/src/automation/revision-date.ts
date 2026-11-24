/**
 * The current time as a tracked change's `@w:date`: UTC, to the second.
 *
 * Seconds precision: milliseconds are valid `xsd:dateTime`, but two revisions that differ only
 * in milliseconds never group. Every editor and automation write that stamps a revision or a
 * comment calls this helper, so the editing API saves the same markup as the editor.
 */
export const revisionDateNow = (): string => `${new Date().toISOString().slice(0, 19)}Z`;

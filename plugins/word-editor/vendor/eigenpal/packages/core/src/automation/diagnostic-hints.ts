import type {
  CollaborationDiagnosticCode,
  DiagnosticCode,
  EditDiagnosticCode,
} from './diagnostic-vocabulary.ts';

/**
 * What a diagnostic code means and what to do about it.
 *
 * Both strings are constants written for developers. They never contain document content, so
 * an exporter can send them with the event.
 *
 * @public
 */
export interface DiagnosticExplanation {
  /** One or two sentences: the cause, then the action. */
  readonly hint: string;
  /** The documentation anchor for this code, such as `…/guides/diagnostics#edit-read-only`. */
  readonly docs: string;
}

const DOCS = 'https://docx-editor.dev/docs/2.x/guides/diagnostics';

/** The anchor of a code in the diagnostics guide: `edit.read-only` is `#edit-read-only`. */
export function diagnosticAnchor(code: string): string {
  return code.replace('.', '-');
}

/**
 * A `Record` over the whole union, so a new code without a hint fails the type check.
 * Kept in English: these are developer messages, not interface strings.
 */
const HINTS: Readonly<Record<Exclude<DiagnosticCode, CollaborationDiagnosticCode>, string>> = {
  'open.unsupported-source':
    "The editor was given something that is not DOCX bytes. Pass a Uint8Array or an ArrayBuffer of a .docx file, or 'blank'.",
  'open.zip-corrupt':
    'The file is not a valid ZIP archive, or a compressed entry is damaged. Ask for a fresh copy of the file.',
  'open.zip-invalid-entry-name':
    'The archive contains an entry with an unsafe path, such as ".." or a leading "/". The editor refuses it for safety.',
  'open.zip-entry-limit':
    'The archive has more entries than the open limit allows. For a trusted file, the server API accepts a higher limit: limits.zip.maxEntries in createServer.',
  'open.zip-size-limit':
    'The archive expands to more than the total size limit. For a trusted file, the server API accepts a higher limit: limits.zip.maxTotalBytes in createServer.',
  'open.zip-ratio-limit':
    'The file expands to many times its compressed size, which is how a decompression bomb looks. For a trusted file, the server API accepts a higher limit: limits.zip.maxRatio in createServer.',
  'open.xml-malformed':
    'An XML part of the document is not well formed. Opening and saving the file in a desktop editor usually repairs it.',
  'open.xml-dtd-forbidden':
    'An XML part declares a DTD or an entity. The editor refuses these to block XML entity attacks.',
  'open.xml-part-size-limit':
    'One XML part is larger than the per-part size limit. For a trusted file, the server API accepts a higher limit: limits.xml.maxBytes in createServer.',
  'open.xml-depth-limit':
    'An XML part nests deeper than the depth limit, often through deeply nested tables. This limit is fixed; flatten the nesting to open the file.',
  'open.xml-element-limit':
    'An XML part has more elements than the element limit. For a trusted file, the server API accepts a higher limit: limits.xml.maxElements in createServer.',
  'open.invalid-limits':
    'The limits passed to createServer are not valid numbers. Check the limits option.',
  'open.content-types-invalid':
    'The file has no valid [Content_Types].xml part, so it is not a usable Office package. Save it again as .docx.',
  'open.missing-main-document':
    'The package has no main document part. The file may be a different Office format, such as .xlsx or .pptx, renamed to .docx.',
  'open.relationships-invalid':
    'A relationship in the package is invalid or duplicated. Opening and saving the file in a desktop editor usually repairs it.',
  'open.relationship-limit':
    'The package has more relationships than the open limit allows. For a trusted file, the server API accepts a higher limit: limits.maxRelationships in createServer.',
  'open.part-limit':
    'The package has more XML parts than the open limit allows. For a trusted file, the server API accepts a higher limit: limits.maxXmlParts in createServer.',
  'open.failed':
    'The document could not be opened for a reason without a specific code. Report it with the engine version.',
  'save.no-document':
    'save() ran before a document was loaded, or after it failed to open. Wait for the open to finish, and check the document.open event for a refusal.',
  'save.document-changed':
    'A new document was loaded while save() waited for a pending edit. Save again after the new document opens.',
  'save.failed':
    'save() threw. The errorName and stage fields name the class of the error; its message is never reported. Report it with the editor version.',

  'edit.read-only':
    'The document is open for viewing or is protected as read-only, so edits are refused. Change the editing mode, or remove the protection.',
  'edit.protected-content':
    'The edit touches content that document protection or a locked content control does not allow you to change.',
  'edit.suggesting-needs-author':
    'Suggesting (tracking changes) needs an author to attribute each change to. Pass the author option or call setAuthor.',
  'edit.review-module-required':
    'This operation needs the review module. Register reviewModule() from @docx-editor.dev/pro in modules.',
  'edit.tracked-drawing-delete-unsupported':
    'This operation cannot record a drawing deletion as a tracked change, so nothing was deleted. Leave the drawing and report it, or ask a person to delete it in the editor, which records the deletion as a tracked change.',
  'edit.tracked-structure-unsupported':
    'This structural edit cannot be recorded as a tracked change. Edit the text inside the structure instead, or ask a person to make the change with tracking off.',
  'edit.tracked-operation-unsupported':
    'This editing API operation cannot be recorded as a tracked change, so nothing was applied. Use text edits such as range.insertText or range.delete, which tracking records. Never switch tracking off to make the edit succeed.',
  'edit.tracking-mode-unsupported':
    'TrackAll needs every collaborator to enforce tracking, which this runtime cannot guarantee. Use TrackMineOnly instead.',
  'edit.tracking-author-required':
    'TrackMineOnly needs an author for each tracked change. Pass the author option to createServer or createBrowser. The author set on the editor does not apply to an editing API batch.',
  'edit.comment-author-mismatch':
    'Only the configured runtime author can edit their comment or reply. Read authorName and configure the runtime with the matching author identity.',
  'edit.comment-author-required':
    'A comment or reply from the editing API needs an author. Pass the author option to createServer or createBrowser. In a React or Vue host with the review module, use useReview().comment or useReview().reply instead, which write as the author set on the editor.',
  'edit.tracking-unsupported-host':
    'This automation host does not support change tracking. The runtimes from createServer and from a mounted editor both support TrackMineOnly.',
  'edit.revision-unsupported':
    'The edit, accept, or reject touches a tracked change of a kind the editor cannot change yet. Edit around it, and leave that change for a person to review.',
  'edit.tracking-required':
    'Document protection allows edits only as tracked changes. Switch to suggesting mode, or set document.changeTrackingMode to TrackMineOnly in an editing API batch, then edit again.',
  'edit.tracked-image-replace-unsupported':
    'Replacing a picture cannot be recorded as a tracked change, so the picture did not change. Insert the new picture as a tracked insertion, or ask a person to replace it with tracking off.',
  'edit.tracked-deleted-text-only':
    'The tracked deletion or replacement covers only text that is already deleted, so nothing was applied. Include live text in the range, or insert next to the deleted text instead.',
  'edit.tracked-foreign-revision-unsupported':
    'The tracked edit touches a pending change of another author in a way this editor cannot record: their paragraph mark, formatting, move, or structural change, or a link or content control inside their insertion. Nothing was applied. Edit outside that change, or leave it for a person to review first. A formatting change that leaves the formatting unchanged has no review card but still counts; Accept All or Reject All over the story clears it.',
  'edit.tracked-own-pending-change':
    "The tracked edit covers or borders your own pending change and would merge with that decision, so nothing was applied. Read the proposed text with getReviewedText('Current'), then edit a range outside your pending change. To change your proposal itself, reject it and propose again.",
  'edit.picture-selected':
    'A picture is selected, so the new picture has no place to go and nothing was inserted. Place the caret in text next to the picture, then insert again.',
  'edit.cross-structure-join':
    'The edit would join paragraphs that live in different containers, such as two table cells. Edit each container separately.',
  'edit.indivisible-content':
    'The edit would split content that must stay whole, such as an equation or a field, or a paragraph break would land inside an inline content control. Select the whole item, or make the edit outside the control.',
  'edit.field-structure':
    'The edit would break the structure of a field. Edit the field result as a whole, or remove the whole field.',
  'edit.field-unsupported':
    'The field type or instruction is not one the editing API writes. Fields that fetch, embed, link, run, or prompt always refuse. Use Page, NumPages, Ref, PageRef, NoteRef, Seq, StyleRef, Date, Time, or TOC with supported arguments. The instruction is written as text and never run.',
  'edit.field-result-unsupported':
    "The operation is not one a field result supports. A field result reads its text and takes insertText(text, 'Replace') with plain text; its other range members refuse. A result write also refuses when the result holds content other than plain runs. Read or write the result with those members only.",
  'edit.ooxml-unsupported':
    'The OOXML is not the one shape insertOoxml inserts: a Flat OPC package (pkg:package) whose document part holds one paragraph with exactly one inline m:oMath and, around it, plain runs. Other parts, relationships, images, fields, paragraph properties, display equations, and unknown elements refuse. Send only that shape.',
  'edit.style-not-defined':
    'The style name is not defined in this document, or it names a style of another type. List the defined styles with document.getStyles(), then assign the nameLocal of a listed style of the right type: a paragraph style for paragraph, range, and body styles, and a table style for a table.',
  'edit.no-styles-defined':
    'The document has no styles part, so it defines no styles and no style name applies. Leave the style as it is, or start from a document whose styles part defines the style you need.',
  'edit.section-mark':
    'The edit would remove a section break that holds page layout settings. Remove the section break on its own.',
  'edit.content-required':
    'The edit would remove the last paragraph of a body, note, comment, text box, or table cell, or the last row or column of a table. Each of them must keep that content. Clear the text instead, or delete the whole table.',
  'edit.table-structure-unsupported':
    'The table edit is not supported for this table shape, for example a legacy horizontal merge, a row that starts or ends with an authored gap, or cells that do not fit the column grid. Edit that row or table directly.',
  'edit.table-merge-not-rectangle':
    'The cells to merge do not form a rectangle, or the rectangle holds only one cell. Name the top-left and bottom-right cells of a rectangle that no merged cell crosses, then merge again.',
  'edit.table-split-unsupported':
    'The cell cannot split into these counts. A cell merged over several rows splits into a number of rows that divides its rows, each new column must keep the minimum column width, and a table without a column grid splits into a divisor of the columns the cell spans.',
  'edit.table-insert-refused':
    'A table cannot be inserted at the selection, for example inside a field or a locked content control. Move the caret first.',
  'edit.table-of-contents-refused':
    'The table of contents could not be inserted or updated at this place. Check that the selection is in the main document body.',
  'edit.unsupported-content':
    'The edit touches content the editor shows but cannot change yet. The content is kept as it is.',
  'edit.operation-unsupported':
    'This editing API operation or option is not supported by this runtime or host. Check the compatibility notes for the member you called.',
  'edit.unsupported-story':
    'This part of the document, such as a header, a footer or a note, does not support this edit.',
  'edit.unmapped-change':
    'The browser changed the page in a way the editor could not express as a document edit, so the change was undone.',
  'edit.stale-target':
    'The operation addresses content that no longer exists, usually after a remote or undone change. Read the document again and retry.',
  'edit.invalid-argument':
    'The arguments are not valid for this target, such as text with a character the call does not take, a value out of range, or a range that spans more than the call allows. Check each argument against the method or editor command you called.',
  'edit.resource-limit':
    'The edit would exceed a size or nesting limit. Split the change into smaller edits.',
  'edit.refresh-in-progress':
    'An external document refresh is in progress. Retry the edit after the refresh completes.',
  'edit.preview-active':
    'A preview is open over the document, so the editor refuses writes and a second preview. Commit or discard the open preview, then retry.',
  'edit.preview-unsupported':
    'A preview cannot show this operation, so nothing was shown. Write it with run() after the preview, or leave it out of the preview.',
  'edit.preview-composing':
    'An input method composition is in progress, so no preview began. Retry after the composition ends.',
  'edit.preview-diverged':
    'The document answered a replayed read differently from the preview, so the commit wrote nothing. Read the document again and build a new preview.',
  'edit.read-after-commit':
    'The writes in this sync are applied, and a load that followed them failed. Read the document again before you decide; do not apply the same edit again.',
  'edit.collaboration-not-ready':
    'The collaboration session is not ready to replicate edits, so this one was refused. Wait for the ready status, then retry; a destroyed session needs a rejoin.',
  'edit.collaboration-text-limit':
    'One edit inserted more text than a collaboration session accepts at once. Insert the text in smaller parts.',
  'edit.internal-invariant':
    'The editor refused an edit to protect the document structure. This is an engine defect: report the code with the engine version.',
  'edit.refused':
    'The edit was refused for a reason without a specific code. Read snapshot().lastRejection for the local message.',

  'review.revision-unsupported':
    'The editor cannot accept or reject a tracked change of this kind, so it was left in the document. Keep it, or replace the content with a direct edit while change tracking is off.',
  'review.incomplete-group':
    'The tracked change resolves only together with a change the decision leaves out, such as the deleted row that holds it or a change the filter hides. Decide that change first, or clear the filter to review it.',
  'review.retained-structure':
    'The row stays because it holds a table whose rows are not tracked. To resolve the changes in its cells, use resolve(), or Accept All or Reject All in the editor; acceptAll() and rejectAll() refuse whole. Delete the row with change tracking off to remove it.',
  'review.locked-content':
    'A content control locks the content, so the decision would change locked text. Remove the lock (set `ContentControl.cannotEdit` to false, or ask the document owner), then decide the change.',
  'review.bound-content':
    'The change is in a content control bound to a custom XML part, which the editor cannot keep in step. Keep the change, or update the bound data and remove the binding outside the editor, then decide it.',
  'review.stale-revision':
    'The tracked change no longer exists, usually because it was resolved already. Read the review items again.',

  'font.shaper-unavailable':
    'The text shaper did not load, so text is measured with fallback metrics. Check that your bundler serves the HarfBuzz WebAssembly file.',
  'font.load-failed':
    'A font face could not be loaded. The editor uses a substitute. Check the font source URL and its CORS headers.',
  'font.missing':
    'A font the document asks for is not available. The editor uses a substitute. Add the face to the fonts option.',
  'font.integrity-mismatch':
    'A font face does not match its declared hash or metadata, so the editor refused it and used a substitute.',
  'font.malformed':
    'A font file is not a valid font, so the editor refused it and used a substitute. Check the file the font source points at.',
  'font.size-limit':
    'A font file is larger than the font byte budget, so the editor used a substitute. Subset the font, or serve a smaller face.',
  'history.split':
    'An edit started a new undo step inside a gesture you meant as one. Wrap the gesture in beginHistoryGroup and end it when the gesture ends.',
  'history.possible-ungrouped-gesture':
    'Several commands ran in quick succession without a history group, so undo may take them back one at a time. Use beginHistoryGroup for one user gesture.',
  'history.possible-fragmented-gesture':
    'One gesture was split across several history groups, so undo may need several steps. Keep one history group open for the whole gesture.',
  'custom-node.payload-invalid':
    'A custom node payload in the document does not match the node schema, so the node opened without its data. Check the schema version that wrote the file.',
  'custom-node.payload-missing':
    'A custom node points at a payload the document does not contain, often after a partial export or a manual edit. The node opened without its data.',
  'font.unsupported-face':
    'A font face uses a format or face index the editor does not support. The editor uses a substitute.',
  'performance.slow-interaction':
    'More than one key press or click in 20 took over 200 ms to reach the screen. Compare the layout and paint timings in this event: slow layout follows document size, slow paint follows the pages on screen.',
};

/** Collaboration codes share hints by cause, as the failure code groups do. */
const COLLAB_GATE =
  'The collaboration session could not take work: it was not attached, not ready yet, or already destroyed. Wait for the ready status, or rejoin when the session was destroyed.';
const COLLAB_INPUT =
  'The collaboration factory rejected a value before joining. Fix the document id, session id, or identity that the host passed.';
const COLLAB_JOIN =
  'Joining the room did not complete. Check that the provider is connected and the room id is right, then rejoin.';
const COLLAB_SEED =
  'The document cannot seed a collaboration room. Open the file on its own to find the problem, or seed the room from another copy.';
const COLLAB_FORMAT =
  'This client and the room use different collaboration formats. Save local work, then upgrade the client or migrate the room.';
const COLLAB_ROOM =
  'The room is unusable. Save a copy, then create a new room from saved document bytes.';
const COLLAB_REMOTE =
  'A remote update could not be applied yet. Edits pause and the session heals when a later update arrives. No action is needed unless it persists.';
const COLLAB_LIMIT =
  'Shared state reached a resource limit. A refused local edit is taken back automatically; a room over a limit must be recreated from a saved copy.';
const COLLAB_MALFORMED =
  'A value in the shared state is malformed or points at something that does not exist. A refused local edit is taken back automatically; a room that holds such a value must be recreated from a saved copy.';
const COLLAB_RESERVED =
  'The room server refused the saved room. Check the server storage, then rejoin.';
const COLLAB_DEPRECATED =
  'This collaboration code is no longer emitted. Upgrade the packages on every client and server.';

const COLLABORATION_HINTS: Readonly<Record<CollaborationDiagnosticCode, string>> = {
  'collab.collaboration-session-destroyed': COLLAB_GATE,
  'collab.collaboration-session-not-attached': COLLAB_GATE,
  'collab.collaboration-session-not-ready': COLLAB_GATE,
  'collab.collaboration-text-limit':
    'One edit inserted more text than a collaboration session accepts at once. Insert the text in smaller parts.',
  'collab.experimental-collaboration-body-text-only':
    'This session replicates only body text, and the edit touched another part of the document. Make that change outside collaboration.',
  'collab.invalid-document-id': COLLAB_INPUT,
  'collab.invalid-identity': COLLAB_INPUT,
  'collab.invalid-identity-color': COLLAB_INPUT,
  'collab.invalid-session-id': COLLAB_INPUT,
  'collab.already-initialized': COLLAB_JOIN,
  'collab.document-id-mismatch': COLLAB_JOIN,
  'collab.initialization-aborted': COLLAB_JOIN,
  'collab.not-initialized': COLLAB_JOIN,
  'collab.baseline-too-large': COLLAB_SEED,
  'collab.blob-read': COLLAB_SEED,
  'collab.invalid-baseline': COLLAB_SEED,
  'collab.missing-local-blob': COLLAB_SEED,
  'collab.no-main-document-part': COLLAB_SEED,
  'collab.collaboration-format-mismatch': COLLAB_FORMAT,
  'collab.protocol-version-mismatch': COLLAB_FORMAT,
  'collab.schema-version-mismatch': COLLAB_FORMAT,
  'collab.blob-digest-mismatch': COLLAB_ROOM,
  'collab.concurrent-seed': COLLAB_ROOM,
  'collab.port-already-attached': COLLAB_ROOM,
  'collab.duplicate-paragraph-id': COLLAB_REMOTE,
  'collab.invalid-relationships': COLLAB_REMOTE,
  'collab.materialize-dropped-content': COLLAB_REMOTE,
  'collab.missing-blob': COLLAB_REMOTE,
  'collab.missing-root': COLLAB_REMOTE,
  'collab.remote-apply-failed': COLLAB_REMOTE,
  'collab.unknown-paragraph-id': COLLAB_REMOTE,
  'collab.blob-store-full': COLLAB_LIMIT,
  'collab.blob-too-large': COLLAB_LIMIT,
  'collab.invalid-blob-descriptor': COLLAB_MALFORMED,
  'collab.invalid-bound': COLLAB_MALFORMED,
  'collab.invalid-logical-id': COLLAB_MALFORMED,
  'collab.invalid-string':
    'A shared value is not valid XML text, so the session refused it. A peer sent malformed state; save a copy and recreate the room.',
  'collab.prototype-key':
    'A shared state key would reach object internals, so the session refused it. A peer sent malformed state; save a copy and recreate the room.',
  'collab.text-too-long': COLLAB_LIMIT,
  'collab.too-many-attributes': COLLAB_LIMIT,
  'collab.too-many-children': COLLAB_LIMIT,
  'collab.too-many-nodes': COLLAB_LIMIT,
  'collab.too-many-parts': COLLAB_LIMIT,
  'collab.too-many-relationships': COLLAB_LIMIT,
  'collab.tree-too-deep': COLLAB_LIMIT,
  'collab.unknown-logical-id': COLLAB_MALFORMED,
  'collab.unsafe-part-name':
    'A shared package part has an unsafe name, so the session refused it. A peer sent malformed state; save a copy and recreate the room.',
  'collab.invalid-saved-room': COLLAB_RESERVED,
  'collab.saved-room-unavailable': COLLAB_RESERVED,
  'collab.baseline-digest-mismatch': COLLAB_DEPRECATED,
  'collab.experimental-collaboration-existing-paragraphs-only': COLLAB_DEPRECATED,
  'collab.experimental-collaboration-text-only': COLLAB_DEPRECATED,
  'collab.experimental-collaboration-untracked-text-only': COLLAB_DEPRECATED,
  'collab.immutable-baseline-changed': COLLAB_DEPRECATED,
  'collab.immutable-metadata-changed': COLLAB_DEPRECATED,
  'collab.invalid-shared-metadata': COLLAB_DEPRECATED,
  'collab.local-mirror-failed': COLLAB_DEPRECATED,
  'collab.paragraph-set-mismatch': COLLAB_DEPRECATED,
  'collab.shared-schema-invalid': COLLAB_DEPRECATED,
  'collab.unsupported-root-key': COLLAB_DEPRECATED,
  'collab.initialization-timeout':
    'Joining the room timed out. Check that the collaboration server is reachable, then rejoin.',
  'collab.authentication-failed':
    'The collaboration server refused the credential. Refresh the token, then rejoin. Reconnecting with the same token fails again.',
  'collab.room-generation-changed':
    'The server compacted the room while this client was away. Save a copy if it holds unsent changes, then rejoin.',
  'collab.transport':
    'The collaboration transport failed. Check the network and the server, then rejoin.',
  'collab.transport-disconnected':
    'The connection to the collaboration server dropped. The session reconnects on its own; edits continue offline when offline editing is on.',
};

const ALL_HINTS: Readonly<Record<DiagnosticCode, string>> = { ...HINTS, ...COLLABORATION_HINTS };

/**
 * What a diagnostic code means and what to do about it.
 *
 * @example
 * ```ts
 * editor.on('diagnostic', (event) => {
 *   if (event.kind === 'edit.rejected') console.warn(explainDiagnostic(event.code).hint);
 * });
 * ```
 *
 * @public
 */
export function explainDiagnostic(code: DiagnosticCode): DiagnosticExplanation {
  return {
    hint: ALL_HINTS[code] ?? HINTS['edit.refused'],
    // An unknown code, from plain JavaScript or a newer engine, links to the page itself.
    docs: Object.hasOwn(ALL_HINTS, code) ? `${DOCS}#${diagnosticAnchor(code)}` : DOCS,
  };
}

/** Whether a string is a public edit code. */
export function isEditDiagnosticCode(value: string): value is EditDiagnosticCode {
  return value.startsWith('edit.') && Object.hasOwn(HINTS, value);
}

/** Every public code, in declaration order. For coverage tests and catalogs. @public */
export function diagnosticCodes(): readonly DiagnosticCode[] {
  return Object.keys(ALL_HINTS) as DiagnosticCode[];
}

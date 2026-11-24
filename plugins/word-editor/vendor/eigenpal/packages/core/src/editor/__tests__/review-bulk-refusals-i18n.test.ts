// Every refusal Accept All or Reject All can show is a catalogue sentence. Each is keyed on the
// engine's exact English in `DISABLED_REASON_KEYS`, so a paraphrase on either side would reach
// every locale raw; this test is what notices.
import { expect, test } from 'bun:test';
import { createT, en, localizeDisabledReason } from '@docx-editor.dev/i18n';
import { BULK_REVIEW_REFUSALS } from '../docx-editor-review-commands.ts';

const t = createT(en);

test.each([...BULK_REVIEW_REFUSALS])('%s', (reason) => {
  const localized = localizeDisabledReason(reason, t);
  expect(localized).not.toBe(reason);
  expect(localized?.length ?? 0).toBeGreaterThan(0);
});

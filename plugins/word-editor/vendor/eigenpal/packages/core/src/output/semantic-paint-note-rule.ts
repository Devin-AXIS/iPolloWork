import { noteSeparatorRuleBox } from '../layout/note-separator-rule.ts';
import type { LineRecord, StyleSpanRecord } from '../layout/semantic-records.ts';

export function paintNoteSeparatorSpan(
  document: Document,
  span: StyleSpanRecord,
  line: LineRecord,
  scale: number
): HTMLElement {
  const host = document.createElement('span');
  host.dataset.docxNoteRule = 'single';
  host.setAttribute('contenteditable', 'false');
  host.setAttribute('aria-hidden', 'true');
  host.style.display = 'inline-block';
  host.style.position = 'relative';
  host.style.verticalAlign = 'top';
  host.style.width = `${span.box.width * scale}px`;
  host.style.height = `${Math.min(span.box.height + (line.leading ?? 0), line.box.height) * scale}px`;
  const box = noteSeparatorRuleBox(span, line);
  const rule = document.createElement('span');
  rule.style.position = 'absolute';
  rule.style.left = '0';
  rule.style.top = `${(box.y - line.box.y) * scale}px`;
  rule.style.width = `${box.width * scale}px`;
  rule.style.height = `${box.height * scale}px`;
  rule.style.backgroundColor = span.style.color ? `#${span.style.color}` : '#000000';
  host.append(rule);
  return host;
}

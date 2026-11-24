import { loadCommentFixture, markedComment, W } from './comment-lifecycle-test-support.ts';

/** Synthetic large document for batch scan and automation regressions. */
export function commentBatchFixture(threads = 600, fillerParagraphs = 12_500) {
  const ids = Array.from({ length: threads }, (_, index) => String(index));
  return loadCommentFixture({
    body:
      ids.map((id) => markedComment('kept', id)).join('') +
      '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(fillerParagraphs),
    comments: `<w:comments xmlns:w="${W}">${ids.map((id) => `<w:comment w:id="${id}" w:author="Reviewer"><w:p><w:r><w:t>remark</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`,
  });
}

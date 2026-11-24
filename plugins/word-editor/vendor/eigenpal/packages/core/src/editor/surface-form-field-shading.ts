import { readViewSettings } from '@docx-editor.dev/core/store';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';

/** The document setting is shared by every field paint and memoized per package revision. */
export function createFormFieldShading(
  session: Pick<TreeDocxSessionView, 'packageRevision' | 'settingsRoot'>
): () => boolean {
  let revision = -1;
  let visible = true;
  return () => {
    const current = session.packageRevision();
    if (revision !== current) {
      revision = current;
      visible = !readViewSettings(session.settingsRoot()).doNotShadeFormData;
    }
    return visible;
  };
}

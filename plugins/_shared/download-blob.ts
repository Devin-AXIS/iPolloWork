import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';

export async function downloadBlob(fileActions: FileActions, blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  try {
    return await fileActions.save({ url, name, mediaType: blob.type }, 'download');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Persist channel files through native uploads before constructing a model prompt. */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface InboundMediaFile {
  name: string
  path: string
  mediaType?: string
  transcript?: string
  receiptId?: string
  speech?: { status: 'transcribed' | 'unavailable' | 'failed' | 'too-large'; text?: string }
}
export interface StagedMedia {
  directory: string
  files: readonly InboundMediaFile[]
  cleanup(): Promise<void>
}
export interface MediaServices {
  upload(request: { sessionId: string; name: string; data: AsyncIterable<Uint8Array>; signal?: AbortSignal }): Promise<{ receiptId: string }>
  transcribe?: (audio: Uint8Array, mediaType: string | undefined, signal: AbortSignal | undefined) => Promise<string>
  maxSpeechBytes: number
}

/** Retain original bytes and optionally transcribe audio; transcription never discards an attachment. */
export async function retainInboundMedia<T extends StagedMedia>(staged: T, sessionId: string, services: MediaServices, signal?: AbortSignal): Promise<T> {
  const files: InboundMediaFile[] = []
  for (const file of staged.files) {
    signal?.throwIfAborted()
    const path = join(staged.directory, basename(file.path))
    const data = createReadStream(path)
    let receipt: { receiptId: string }
    try {
      receipt = await services.upload({ sessionId, name: file.name, data, ...(signal ? { signal } : {}) })
    } finally {
      data.destroy()
    }
    const retained: InboundMediaFile = { ...file, receiptId: receipt.receiptId }
    if (file.mediaType?.startsWith('audio/')) {
      if (file.transcript?.trim()) {
        retained.speech = { status: 'transcribed', text: file.transcript.trim() }
      } else if (!services.transcribe) {
        retained.speech = { status: 'unavailable' }
      } else if ((await stat(path)).size > services.maxSpeechBytes) {
        retained.speech = { status: 'too-large' }
      } else {
        try {
          const text = await services.transcribe(await readFile(path, { ...(signal ? { signal } : {}) }), file.mediaType, signal)
          retained.speech = text.trim() ? { status: 'transcribed', text: text.trim() } : { status: 'failed' }
        } catch (error) {
          signal?.throwIfAborted()
          // Provider diagnostics may contain credentials; only this status reaches the model.
          retained.speech = { status: 'failed' }
        }
      }
    }
    files.push(retained)
  }
  return { ...staged, files }
}

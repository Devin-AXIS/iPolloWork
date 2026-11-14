// voice.mjs — Telegram voice input as a speechToText consumer.
//
// The recognizer is not a channel concern: `ctx.speechToText`
// (@deepseek-ai/dsh-experimental-speech-to-text) owns a registry of named
// providers and validates the recording format, so this module only turns a
// downloaded Telegram attachment into the canonical 16 kHz mono PCM16 WAV and
// forwards the transcript. No endpoint, model or key is configured here.
//
// Without the service — or with no provider selected — voice messages keep
// their previous behaviour and arrive without text.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Sample rate every speechToText provider accepts. */
export const VOICE_SAMPLE_RATE = 16_000;

/** Telegram caps bot downloads at 20 MB, so a recording never exceeds it. */
export const VOICE_MAX_BYTES = 20 * 1024 * 1024;

const EXTENSIONS = Object.freeze({
  'audio/ogg': 'ogg',
  'audio/oga': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
});

function extensionFor(mimeType) {
  const key = typeof mimeType === 'string' ? mimeType.toLowerCase().split(';')[0].trim() : '';
  return EXTENSIONS[key] ?? 'audio';
}

/**
 * The voice or audio attachment of one Telegram message, or null.
 *
 * `voice` is a recorded voice note (OGG/Opus); `audio` is a music-like file
 * sent as audio. Both carry a `file_id` the Bot API can download.
 */
export function telegramVoiceSource(message) {
  const voice = message?.voice;
  if (typeof voice?.file_id === 'string' && voice.file_id) {
    return Object.freeze({
      kind: 'voice',
      fileId: voice.file_id,
      fileName: typeof voice.file_name === 'string' && voice.file_name ? voice.file_name : 'voice.ogg',
      mimeType: typeof voice.mime_type === 'string' && voice.mime_type ? voice.mime_type : 'audio/ogg',
      seconds: Number.isFinite(voice.duration) ? voice.duration : null,
    });
  }
  const audio = message?.audio;
  if (typeof audio?.file_id === 'string' && audio.file_id) {
    return Object.freeze({
      kind: 'audio',
      fileId: audio.file_id,
      fileName: typeof audio.file_name === 'string' && audio.file_name ? audio.file_name : 'audio.mp3',
      mimeType: typeof audio.mime_type === 'string' && audio.mime_type ? audio.mime_type : 'audio/mpeg',
      seconds: Number.isFinite(audio.duration) ? audio.duration : null,
    });
  }
  return null;
}

/** Human-readable recording length (`0:07`), or `unknown duration`. */
export function formatVoiceDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unknown duration';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function shorten(text, limit = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Transcript substitute handed to the model when a recording stays textless.
 *
 * The channel never answers the user on its own: the model reads this note and
 * decides what to say, in the user's language, without inventing the content.
 */
export function voiceNote({ voice, reason }) {
  return `[voice message, ${formatVoiceDuration(voice?.seconds ?? null)}; ${reason}]`;
}

/** Short cause text for a failed transcription. */
export function voiceFailureReason(error) {
  const message = String(error?.message ?? error ?? '');
  if (error?.code === 'ENOENT' || /\bENOENT\b/.test(message)) return 'ffmpeg is not installed';
  if (/Voice recording is larger than/.test(message)) return 'recording is too large';
  const exit = message.match(/ffmpeg exited with code (\d+)/);
  if (exit) return `ffmpeg failed with code ${exit[1]}`;
  if (error?.code === 'speech-provider') return `speech provider failed: ${shorten(message)}`;
  return `transcription failed: ${shorten(message)}`;
}

/** Tag provider failures so the reason text tells them apart from ffmpeg. */
function providerFailure(error) {
  if (error && typeof error === 'object' && !error.code) error.code = 'speech-provider';
  return error;
}

const WAV_HEADER_BYTES = 44;
const PCM_BYTES_PER_SAMPLE = 2;

/**
 * True only for the layout the Host validator accepts: RIFF/WAVE, a 16-byte
 * PCM `fmt ` chunk, and a `data` chunk starting at byte 36.
 *
 * A `audio/wav` MIME type says nothing about rate, channels or container, so
 * the shortcut has to look at the bytes.
 */
export function isCanonicalWav(audio) {
  if (!audio || audio.length < WAV_HEADER_BYTES) return false;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const tag = (offset) => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return false;
  if (view.getUint32(4, true) !== audio.length - 8) return false;
  if (view.getUint32(16, true) !== 16) return false;
  if (view.getUint16(20, true) !== 1) return false; // PCM
  if (view.getUint16(22, true) !== 1) return false; // mono
  if (view.getUint32(24, true) !== VOICE_SAMPLE_RATE) return false;
  if (view.getUint16(34, true) !== 16) return false; // PCM16
  const dataBytes = view.getUint32(40, true);
  return audio.length === WAV_HEADER_BYTES + dataBytes
    && dataBytes % PCM_BYTES_PER_SAMPLE === 0;
}

/**
 * Wrap raw PCM16 samples in the canonical container.
 *
 * ffmpeg writes its own `LIST`/`INFO` chunk after `fmt `, which the Host
 * validator rejects, so the container is built here instead of trusting the
 * muxer's metadata layout.
 */
export function wrapCanonicalWav(pcm) {
  const dataBytes = pcm.length;
  const buffer = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(WAV_HEADER_BYTES - 8 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(VOICE_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(VOICE_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE, 28);
  buffer.writeUInt16LE(PCM_BYTES_PER_SAMPLE, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  pcm.copy(buffer, WAV_HEADER_BYTES);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Convert one recording into the canonical transcript container. */
function defaultRunFfmpeg(bin, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 2_000) stderr = stderr.slice(-2_000);
    });
    // A missing binary rejects through 'error', not a non-zero exit code.
    child.on('error', reject);
    child.on('close', (code) => (code === 0
      ? resolve()
      : reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`))));
  });
}

/**
 * Build a transcriber, or null when no speech service is mounted.
 *
 * The runtime treats null as "voice is not transcribable here" and keeps the
 * message text empty, exactly as it behaved before this module existed.
 */
export function createTelegramVoiceTranscriber({
  speechToText,
  ffmpeg = process.env.DSH_IM_FFMPEG || 'ffmpeg',
  language,
  maxBytes = VOICE_MAX_BYTES,
  runFfmpeg = defaultRunFfmpeg,
  workspace = (prefix) => mkdtempSync(join(tmpdir(), prefix)),
  removeDir = (path) => rmSync(path, { recursive: true, force: true }),
} = {}) {
  if (typeof speechToText?.resolve !== 'function' || typeof speechToText?.transcribe !== 'function') {
    return null;
  }
  return Object.freeze({
    /** Transcript text for one downloaded recording; throws when it cannot run. */
    async transcribe({ audio, voice, signal } = {}) {
      if (!audio || typeof audio.length !== 'number' || audio.length === 0) {
        throw new TypeError('Telegram voice transcription needs audio bytes');
      }
      if (audio.length > maxBytes) {
        throw new Error(`Voice recording is larger than ${maxBytes} bytes`);
      }
      // A recording that already is canonical WAV skips the converter; a WAV
      // that is 44.1 kHz stereo still has to be resampled.
      const wavBytes = new Uint8Array(audio);
      let wav;
      if (isCanonicalWav(wavBytes)) {
        wav = wavBytes;
      } else {
        const directory = workspace(`dsh-telegram-voice-${randomUUID()}-`);
        try {
          const input = join(directory, `in.${extensionFor(voice?.mimeType)}`);
          const output = join(directory, 'out.pcm');
          writeFileSync(input, audio);
          // Raw PCM out, so the container is ours and carries no extra chunks.
          await runFfmpeg(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', input,
            '-ar', String(VOICE_SAMPLE_RATE), '-ac', '1', '-f', 's16le', '-c:a', 'pcm_s16le',
            output,
          ], { signal });
          wav = wrapCanonicalWav(readFileSync(output));
        } finally {
          removeDir(directory);
        }
      }
      let spec;
      try {
        spec = speechToText.resolve({ audio: wav, ...(language ? { language } : {}) });
      } catch (error) {
        throw providerFailure(error);
      }
      let transcript;
      try {
        transcript = await speechToText.transcribe(spec, signal ?? new AbortController().signal);
      } catch (error) {
        throw providerFailure(error);
      }
      return typeof transcript?.text === 'string' ? transcript.text.trim() : '';
    },
  });
}

/** @jsxImportSource react */
import * as React from "react";
import { Loader2, Mic, RotateCcw, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { encodeVoiceSampleWav, validateVoiceSampleFile } from "./video-voice";

type Recording = { recorder: MediaRecorder; stream: MediaStream; context: AudioContext; frame: number; timeout: ReturnType<typeof setTimeout> | null };

type VoiceSampleProps = {
  file: File | null;
  disabled: boolean;
  onFile: (file: File | null) => void;
  onError: (error: string) => void;
  onBusy: (busy: boolean) => void;
};

export function VideoVoiceSample({ file, disabled, onFile, onError, onBusy }: VoiceSampleProps) {
  const [mode, setMode] = React.useState("upload");
  const [phase, setPhase] = React.useState<"idle" | "requesting" | "recording" | "processing">("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [level, setLevel] = React.useState(0);
  const [previewUrl, setPreviewUrl] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const recordingRef = React.useRef<Recording | null>(null);
  const generationRef = React.useRef(0);
  const startingRef = React.useRef(false);
  const busy = phase !== "idle";

  const release = React.useCallback(() => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    cancelAnimationFrame(recording.frame);
    if (recording.timeout !== null) clearTimeout(recording.timeout);
    recording.stream.getTracks().forEach(track => track.stop());
    void recording.context.close();
  }, []);

  React.useEffect(() => () => {
    generationRef.current++;
    const recording = recordingRef.current;
    if (recording) {
      recording.recorder.onstop = null;
      recording.recorder.onerror = null;
      recording.recorder.ondataavailable = null;
      if (recording.recorder.state !== "inactive") recording.recorder.stop();
    }
    release();
  }, [release]);

  React.useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  React.useEffect(() => {
    if (!file) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const stop = () => {
    const recording = recordingRef.current;
    if (recording?.recorder.state === "recording") {
      setPhase("processing");
      recording.recorder.stop();
      release();
    }
  };

  const start = async () => {
    if (startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    const generation = ++generationRef.current;
    setPhase("requesting");
    setSeconds(0);
    setLevel(0);
    onError("");
    onFile(null);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error(t("video.voice.record_unavailable"));
      const permission = await window.__IPOLLOWORK_ELECTRON__?.system?.askMicrophoneAccess?.();
      if (generation !== generationRef.current) return;
      if (permission?.platform === "darwin" && !permission.granted) throw new DOMException("Microphone permission denied", "NotAllowedError");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      context = new AudioContext();
      await context.resume();
      if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); void context.close(); return; }
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const recording: Recording = { recorder, stream, context, frame: 0, timeout: null };
      recordingRef.current = recording;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (generation !== generationRef.current) return;
        generationRef.current++;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        release();
        setPhase("idle");
        onError(t("video.voice.record_failed"));
      };
      recorder.onstop = async () => {
        if (generation !== generationRef.current) return;
        release();
        setPhase("processing");
        let decoder: AudioContext | null = null;
        try {
          decoder = new AudioContext();
          const audio = await decoder.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
          if (audio.duration < 10) throw new Error(t("video.voice.error.sample_duration"));
          // A mono 24 kHz sample stays below 3 MB at the 60-second limit.
          const offline = new OfflineAudioContext(1, Math.min(Math.floor(audio.duration * 24000), 60 * 24000), 24000);
          const source = offline.createBufferSource();
          source.buffer = audio;
          source.connect(offline.destination);
          source.start();
          const rendered = await offline.startRendering();
          if (generation !== generationRef.current) return;
          onFile(new File([encodeVoiceSampleWav(rendered.getChannelData(0), 24000)], "voice-recording.wav", { type: "audio/wav" }));
        } catch (error) {
          if (generation === generationRef.current) onError(error instanceof Error ? error.message : t("video.voice.record_failed"));
        } finally {
          if (decoder) void decoder.close();
          if (generation === generationRef.current) setPhase("idle");
        }
      };
      stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => {
        if (recordingRef.current === recording && recorder.state === "recording") stop();
      }, { once: true }));
      recorder.start();
      recording.timeout = setTimeout(() => { setSeconds(60); stop(); }, 60_000);
      setPhase("recording");
      const started = performance.now();
      const data = new Uint8Array(analyser.frequencyBinCount);
      let previousUpdate = 0;
      const draw = () => {
        if (recordingRef.current !== recording) return;
        const elapsed = (performance.now() - started) / 1000;
        if (elapsed >= 60) { setSeconds(60); stop(); return; }
        analyser.getByteTimeDomainData(data);
        const canvas = canvasRef.current;
        const drawing = canvas?.getContext("2d");
        if (canvas && drawing) {
          drawing.clearRect(0, 0, canvas.width, canvas.height);
          drawing.strokeStyle = getComputedStyle(canvas).color;
          drawing.lineWidth = 2;
          drawing.beginPath();
          data.forEach((sample, index) => {
            const x = index / (data.length - 1) * canvas.width;
            const y = sample / 255 * canvas.height;
            if (index === 0) drawing.moveTo(x, y); else drawing.lineTo(x, y);
          });
          drawing.stroke();
        }
        if (elapsed - previousUpdate >= 0.1) {
          previousUpdate = elapsed;
          setSeconds(Math.min(60, Math.floor(elapsed)));
          const energy = data.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0);
          setLevel(Math.min(100, Math.round(Math.sqrt(energy / data.length) * 100)));
        }
        recording.frame = requestAnimationFrame(draw);
      };
      draw();
    } catch (error) {
      release();
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== "closed") void context.close();
      if (generation !== generationRef.current) return;
      setPhase("idle");
      onError(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
        ? t("video.voice.record_permission") : error instanceof Error ? error.message : t("video.voice.record_failed"));
    } finally {
      startingRef.current = false;
    }
  };

  return <div className="space-y-3" data-testid="voice-sample">
    <Tabs value={mode} onValueChange={value => { if (busy) return; setMode(value); onFile(null); onError(""); }}>
      <TabsList className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 group-data-horizontal/tabs:h-[34px]">
        <TabsTrigger value="upload" disabled={disabled || busy} className="h-full rounded-md border-0 px-2 py-0 text-ui-control font-medium shadow-none data-active:shadow-none">{t("video.voice.clone_upload")}</TabsTrigger>
        <TabsTrigger value="record" disabled={disabled || busy} className="h-full rounded-md border-0 px-2 py-0 text-ui-control font-medium shadow-none data-active:shadow-none">{t("video.voice.record_direct")}</TabsTrigger>
      </TabsList>
    </Tabs>
    {mode === "upload" ? <>
      <input ref={inputRef} type="file" accept="audio/wav,audio/mpeg,audio/mp4,.wav,.mp3,.m4a" className="hidden" aria-label={t("video.voice.clone_upload")} onChange={event => {
        const selected = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!selected) return;
        const error = validateVoiceSampleFile(selected, { invalidType: t("video.voice.error.sample_type"), empty: t("video.voice.error.sample_empty"), tooLarge: t("video.voice.error.sample_too_large") });
        onError(error || "");
        onFile(error ? null : selected);
      }} />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-lg bg-muted/45 px-4 py-5 text-center hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Upload aria-hidden="true" className="size-5 text-muted-foreground" /><span className="w-full truncate text-ui-control font-medium">{file?.name || t("video.voice.clone_upload")}</span><span className="text-ui-caption leading-4 text-muted-foreground">{t("video.voice.clone_file_help")}</span>
      </button>
    </> : <div className="space-y-3 rounded-lg bg-muted/45 p-3">
      {phase !== "recording" ? <p className="text-ui-caption leading-4 text-muted-foreground">{t("video.voice.record_help")}</p> : null}
      <div data-testid="voice-record-prompt" className="space-y-1">
        <p className="text-ui-caption font-medium text-muted-foreground">{t("video.voice.record_prompt_label")}</p>
        <p className="text-ui-control leading-5">{t("video.voice.record_prompt")}</p>
      </div>
      {phase === "recording" ? <>
        <div className="flex items-center justify-between text-ui-control font-medium"><span role="status">{t("video.voice.record_active")}</span><span className="tabular-nums">00:{String(seconds).padStart(2, "0")} / 01:00</span></div>
        <canvas ref={canvasRef} width={360} height={48} className="h-12 w-full text-[#1FBAC0]" aria-label={t("video.voice.record_waveform")} />
        <div className="flex items-center gap-3 text-ui-caption text-muted-foreground"><span>{t("video.voice.record_level")}</span><div role="meter" aria-label={t("video.voice.record_level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-foreground" style={{ width: `${level}%` }} /></div><span className="w-8 text-right tabular-nums">{level}%</span></div>
        <Button type="button" variant="outline" className="h-[34px] w-full rounded-lg text-ui-control shadow-none before:shadow-none" onClick={stop}><Square className="size-3.5" />{t("video.voice.record_stop")}</Button>
      </> : <>
        <Button type="button" variant="outline" disabled={disabled || busy} className="h-[34px] w-full rounded-lg text-ui-control shadow-none before:shadow-none" onClick={() => void start()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : file ? <RotateCcw className="size-3.5" /> : <Mic className="size-3.5" />}
          {t(phase === "requesting" ? "video.voice.record_requesting" : phase === "processing" ? "video.voice.record_processing" : file ? "video.voice.record_again" : "video.voice.record_start")}
        </Button>
      </>}
    </div>}
    {previewUrl ? <audio key={previewUrl} data-testid="voice-sample-preview" controls src={previewUrl} className="h-9 w-full" aria-label={t("video.voice.record_preview")} /> : null}
  </div>;
}

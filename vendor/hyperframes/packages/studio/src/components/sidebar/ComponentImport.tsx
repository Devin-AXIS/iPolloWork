import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Upload } from "lucide-react";
import { useStudioI18n } from "../../i18n";
import { useDialogBehavior } from "../ui/useDialogBehavior";

export function ComponentImport({ onImported }: { onImported: () => Promise<void> }) {
  const { locale } = useStudioI18n();
  const zh = locale === "zh";
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ pack: unknown; titles: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const close = () => setPending(null);
  useDialogBehavior({ open: pending !== null, containerRef: dialogRef, onClose: close, canClose: () => !busy });

  async function send(pack: unknown, confirmed: boolean): Promise<string[]> {
    const response = await fetch("/api/registry/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: pack, confirmed }),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(zh ? "当前视频服务尚未支持组件导入，请更新并重新打开视频编辑器。" : "This video service does not support component imports yet. Update and reopen the editor.");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || (zh ? "导入失败" : "Import failed"));
    return result.items.map((item: { title: string }) => item.title);
  }
  async function choose(file: File) {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error(zh ? "组件包需小于 16 MB" : "Component packs must be smaller than 16 MB");
      const pack: unknown = JSON.parse(await file.text());
      setPending({ pack, titles: await send(pack, false) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error)); setFailed(true);
    } finally { setBusy(false); }
  }
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); setFailed(false);
    try {
      const titles = await send(pending.pack, true);
      await onImported();
      setMessage(zh ? `已导入 ${titles.length} 个组件` : `Imported ${titles.length} components`);
      setPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error)); setFailed(true);
    } finally { setBusy(false); }
  }
  return <div className="relative flex-none">
    <input ref={fileRef} type="file" accept=".hfcomponent.json,.json,application/json" className="hidden" aria-label={zh ? "选择组件包" : "Choose component pack"}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void choose(file); }} />
    <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="component-import"
      title={message || (zh ? "导入组件包 · .hfcomponent.json" : "Import component pack · .hfcomponent.json")}
      className="flex h-[34px] items-center gap-1.5 rounded-lg bg-panel-input px-2.5 text-xs text-panel-text-2 hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-panel-accent/40 disabled:opacity-50">
      {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}{zh ? "导入" : "Import"}
    </button>
    {message && !pending && <button type="button" onClick={() => setMessage("")} role={failed ? "alert" : "status"}
      className={`absolute right-0 top-10 z-30 w-64 rounded-lg border border-panel-border bg-panel-bg p-3 text-left text-xs shadow-lg ${failed ? "text-red-500" : "text-panel-text-2"}`}>{message}</button>}
    {pending && createPortal(<div className="fixed inset-0 z-[200] grid place-items-center bg-black/40 p-5" onClick={() => !busy && close()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="component-import-title" tabIndex={-1} onClick={event => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-panel-border bg-panel-bg p-5 text-panel-text-1 shadow-2xl">
        <h2 id="component-import-title" className="text-sm font-semibold">{zh ? "导入到我的组件库" : "Import to my component library"}</h2>
        <ul className="my-4 max-h-48 space-y-1 overflow-y-auto text-xs">{pending.titles.map(title => <li key={title}>{title}</li>)}</ul>
        <p className="text-xs leading-5 text-panel-text-3">{zh ? "组件包含可执行的 HTML / JavaScript，请仅导入信任的来源。导入后可用于所有视频，不会覆盖内置组件或已有项目。" : "Components contain executable HTML / JavaScript. Only import trusted sources. Available to all videos; built-in components and existing projects are preserved."}</p>
        {failed && <p role="alert" className="mt-3 text-xs text-red-500">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg px-3 py-2 text-xs hover:bg-panel-hover">{zh ? "取消" : "Cancel"}</button>
          <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-lg bg-panel-accent px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? (zh ? "导入中…" : "Importing…") : (zh ? "信任并导入" : "Trust and import")}</button>
        </div>
      </div>
    </div>, document.body)}
  </div>;
}

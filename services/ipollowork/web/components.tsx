import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { api, type Row } from "./api.js";

export function useData<T>(path: string) {
  const [data, setData] = useState<T>(), [error, setError] = useState(""), [revision, update] = useState(0);
  useEffect(() => {
    let active = true; setData(undefined); setError("");
    api<T>(path).then(v => { if (active) setData(v); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path, revision]);
  return { data, error, reload: () => update(v => v + 1) };
}
export function Status({ error, loading }: { error?: string; loading?: boolean }) {
  return error ? <div role="alert" className="error">{error}</div> : loading ? <div className="empty" role="status">正在加载…</div> : null;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function Table({ rows, columns }: { rows: Row[]; columns: { label: string; cell: (row: Row) => ReactNode }[] }) {
  if (!rows.length) return <div className="empty">暂无记录</div>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(c => <th key={c.label}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map(c => <td key={c.label}>{c.cell(row)}</td>)}</tr>)}</tbody></table></div>;
}
export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }}>
    <div className="modal-head"><h2>{title}</h2><button type="button" className="icon" aria-label="关闭" onClick={close}><X size={18}/></button></div>{children}
  </dialog>;
}
export function ActionForm({ submit, children, label = "保存" }: { submit: (data: FormData) => Promise<unknown>; children: ReactNode; label?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <form onSubmit={async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError("");
    try { await submit(form); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  }}>{children}<Status error={error}/><div className="form-actions"><button className="primary" disabled={busy}>{busy ? "处理中…" : label}</button></div></form>;
}
export const value = (data: FormData, key: string) => String(data.get(key) ?? "");

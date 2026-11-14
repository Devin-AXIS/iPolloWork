/** Account-owned HTTP access keys inside the existing service center. */
import { useState } from "react";
import { api } from "./api.js";
import { Modal, Status, useData } from "./components.js";

type AccessKey = { id: string; name: string; start: string | null; enabled: boolean; expiresAt: string | null };
/** Render revocable account-scoped credentials; plaintext remains in this dialog only. */
export function AccessKeys({ close }: { close(): void }) {
  const keys = useData<{ items: AccessKey[] }>("/api/v1/access-keys");
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ key: string }>("/api/v1/access-keys", { name, ...(expires ? { expiresIn: Number(expires) } : {}) });
      setSecret(result.key); setName(""); keys.reload();
    } catch (error) { setError(error instanceof Error ? error.message : "创建失败"); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError("");
    try { await api(`/api/v1/access-keys/${encodeURIComponent(id)}`, undefined, "DELETE"); keys.reload(); }
    catch (error) { setError(error instanceof Error ? error.message : "撤销失败"); }
    finally { setBusy(false); }
  };
  return <Modal title="API 接入" close={close}>
    <p>外部应用可查询能力、提交请求和读取任务结果，按当前账号实际用量结算</p>
    <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="field"><span>应用名称</span><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="例如：我的网站" /></label>
      <label className="field"><span>有效期</span><select value={expires} onChange={event => setExpires(event.target.value)}><option value="">不过期</option><option value="604800">7 天</option><option value="2592000">30 天</option><option value="31536000">1 年</option></select></label>
      <button className="primary" disabled={busy || !name.trim()}>{busy ? "处理中…" : "创建访问 Key"}</button>
    </form>
    {secret && <label className="field"><span>新 Key 仅在此处显示一次，请保存后再关闭</span><textarea readOnly aria-label="新访问 Key" value={secret} onFocus={event => event.target.select()} /></label>}
    <Status error={error || keys.error} loading={!keys.data && !keys.error} />
    {keys.data && <div className="table-scroll access-key-list"><table><thead><tr><th>应用</th><th>状态</th><th>操作</th></tr></thead><tbody>{keys.data.items.map(key => <tr key={key.id}><td>{key.name}<small>{key.start}</small></td><td>{!key.enabled ? "已停用" : key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now() ? "已过期" : "有效"}</td><td><button disabled={busy} onClick={() => void revoke(key.id)}>撤销</button></td></tr>)}</tbody></table>{!keys.data.items.length && <p>尚未创建访问 Key</p>}</div>}
    <label className="field"><span>查询可用能力</span><textarea readOnly aria-label="HTTP 调用示例" value={`curl '${location.origin}/api/v1/capabilities' -H 'Authorization: Bearer YOUR_ACCESS_KEY'`} /></label>
    <p>按目录中的能力 ID 获取参数说明，再提交请求；长任务通过返回的任务地址查询。访问 Key 只用于能力接口，不提供后台管理权限</p>
  </Modal>;
}

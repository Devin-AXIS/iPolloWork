/** Editable provider cost cards. User-facing consumption remains denominated in credits. */
import { useState } from "react";
import type { BillingSpec, ModelRate } from "../src/pricing.js";
import { CREDIT_MICROS, rateSchema } from "../src/pricing.js";
import type { ServiceModel } from "../src/model-catalog.js";
import type { ServiceCategory } from "../src/service-categories.js";

const units: Record<NonNullable<ModelRate["unit"]>, { label: string; scale: number }> = {
  token: { label: "每百万 Token", scale: 1 }, video_token: { label: "每百万视频 Token", scale: 1 }, image: { label: "每张", scale: 1 },
  audio_minute: { label: "每分钟音频", scale: 1 }, audio_hour: { label: "每小时音频", scale: 1 },
  video_second: { label: "每秒视频", scale: 1 }, audio_second: { label: "每秒音频", scale: 1 },
  character: { label: "每万字符", scale: 10000 }, request: { label: "每次", scale: 1 },
};

/** Convert a saved legacy media card to per-model prices only when the operator edits that model. */
function modelRate(model: ServiceModel, billing: BillingSpec | undefined, category: ServiceCategory): ModelRate {
  const previous = billing?.rates.find(rate => rate.model === model.id);
  let unit = previous?.unit ?? (category === "audio" ? billing?.kind === "audio" ? "audio_second" : "character" : "token");
  if (category === "image" && !previous) unit = "image";
  if (category === "video" && !previous) unit = "video_second";
  const extra = unit === "character" && !previous?.unit ? { inputUnitPrice: (billing?.charactersPerTenThousand ?? 0) / 10000 } : {};
  return rateSchema.parse({ model: model.id, maxInputTokens: model.contextWindow ?? 131072, maxOutputTokens: model.maxTokens ?? 8192, ...previous, ...extra, unit });
}

function CostField({ label, micros, scale = 1, set }: { label: string; micros: number; scale?: number; set(value: number): void }) {
  return <label className="field"><span>{label}（元）</span><input type="number" min="0" step="any" value={micros * scale / 1000000} onChange={e => set(Math.round(Number(e.target.value) * 1000000 / scale))} /><small>{(micros * scale / CREDIT_MICROS).toLocaleString("zh-CN", { maximumFractionDigits: 4 })} 积分</small></label>;
}

/** Edit per-model provider costs and show their credit equivalents.
 * @param props Model records, pricing and controlled update callbacks.
 * @returns Searchable model pricing controls.
 */
export function ModelPricing({ models, setModels, billing, setBilling, category, source }: {
  models: ServiceModel[]; setModels(models: ServiceModel[]): void;
  billing?: BillingSpec; setBilling(billing: BillingSpec): void;
  category: ServiceCategory; source: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [newId, setNewId] = useState("");
  const change = (model: ServiceModel, rate: ModelRate) => {
    const kind = category === "language" ? "chat" : category === "audio" ? "speech" : category === "tool" ? "request" : category;
    setBilling({ kind, protocol: "openai", source, verifiedAt: Date.now(), validUntil: Date.now() + 30 * 86400000,
      charactersPerTenThousand: 0, second768: 0, second2k: 0, imageInput: 0, maxInputVideoSeconds: 60,
      ...billing, rates: [...(billing?.rates ?? []).filter(entry => entry.model !== model.id), rate] });
  };
  const visible = models.filter(model => (model.id + " " + model.name).toLowerCase().includes(query.toLowerCase()));
  return <section className="model-costs">
    <div className="model-costs-head"><strong>模型与积分</strong><small>1 积分对应 0.001 元模型成本</small></div>
    <input aria-label="搜索模型" placeholder={`搜索 ${models.length} 个模型`} value={query} onChange={e => setQuery(e.target.value)} />
    <div className="model-cost-list">{visible.slice(0, 50).map(model => {
      const rate = modelRate(model, billing, category);
      const priced = billing?.rates.some(entry => entry.model === model.id);
      const unit = rate.unit ?? "token";
      const config = units[unit];
      const tokenCost = unit === "token" || unit === "video_token";
      const pixelTiers = unit === "image" && billing?.protocol === "ark";
      const edit = (patch: Partial<ModelRate>) => {
        if (category === "language" && (patch.maxInputTokens || patch.maxOutputTokens)) setModels(models.map(row => row.id === model.id ? { ...row, ...(patch.maxInputTokens ? { contextWindow: patch.maxInputTokens } : {}), ...(patch.maxOutputTokens ? { maxTokens: patch.maxOutputTokens } : {}) } : row));
        change(model, { ...rate, ...patch });
      };
      const legacyVideo = billing?.kind === "video" && !billing.rates.find(row => row.model === model.id)?.unit;
      return <div className="model-cost-row" key={model.id}>
        <div className="model-cost-summary"><label><input type="checkbox" aria-label={`开放 ${model.id}`} checked={model.enabled !== false} onChange={e => setModels(models.map(row => row.id === model.id ? { ...row, enabled: e.target.checked } : row))} /><span>{model.name}<small>{model.id}</small></span></label><button type="button" aria-expanded={selected === model.id} onClick={() => setSelected(selected === model.id ? undefined : model.id)}>{priced ? "编辑价格" : "设置价格"}</button></div>
        {selected === model.id && legacyVideo && billing && <div className="model-cost-editor"><div className="form-grid">
          <CostField label="768P · 每秒" micros={billing.second768} set={value => setBilling({ ...billing, second768: value })} />
          <CostField label="2K · 每秒" micros={billing.second2k} set={value => setBilling({ ...billing, second2k: value })} />
          <CostField label="额外参考图 · 每张" micros={billing.imageInput} set={value => setBilling({ ...billing, imageInput: value })} />
        </div></div>}
        {selected === model.id && !legacyVideo && <div className="model-cost-editor">
          <label className="field"><span>计费单位</span><select value={unit} onChange={e => edit({ unit: e.target.value as ModelRate["unit"] })}>{Object.entries(units).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}</select></label>
          <div className="form-grid">
            <CostField label={`输入 · ${config.label}`} micros={tokenCost ? rate.inputPerMillion : rate.inputUnitPrice} scale={config.scale} set={value => edit(tokenCost ? { inputPerMillion: value } : { inputUnitPrice: value })} />
            <CostField label={`输出 · ${config.label}`} micros={tokenCost ? rate.outputPerMillion : rate.outputUnitPrice} scale={config.scale} set={value => edit(tokenCost ? { outputPerMillion: value } : { outputUnitPrice: value })} />
            {unit === "token" && <><CostField label="缓存命中 · 每百万 Token" micros={rate.cachedInputPerMillion ?? rate.inputPerMillion} set={value => edit({ cachedInputPerMillion: value })} /><label className="field"><span>最大输出 Token</span><input type="number" min="1" value={rate.maxOutputTokens} onChange={e => edit({ maxOutputTokens: Number(e.target.value) })} /></label></>}
            {unit === "token" && <label className="field"><span>最大输入 Token</span><input type="number" min="1024" value={rate.maxInputTokens} onChange={e => edit({ maxInputTokens: Number(e.target.value) })} /></label>}
            {unit === "token" && category === "image" && <CostField label="输入图像 · 每百万 Token" micros={rate.imageInputPerMillion} set={value => edit({ imageInputPerMillion: value })} />}
            {unit === "token" && rate.audioInputPerMillion > 0 && <><CostField label="输入音频 · 每百万 Token" micros={rate.audioInputPerMillion} set={value=>edit({audioInputPerMillion:value})}/><CostField label="音频缓存 · 每百万 Token" micros={rate.cachedAudioInputPerMillion ?? rate.audioInputPerMillion} set={value=>edit({cachedAudioInputPerMillion:value})}/></>}
            {unit === "token" && category === "embedding" && <CostField label="输入图像 · 每百万 Token" micros={rate.imageInputPerMillion} set={value => edit({imageInputPerMillion:value})}/>}
            {unit === "image" && <label className="field"><span>免费输入图片数</span><input type="number" min="0" value={rate.freeInputUnits} onChange={e=>edit({freeInputUnits:Number(e.target.value)})}/></label>}
            {unit !== "token" && <label className="field"><span>单次最大数量／时长</span><input type="number" min="1" value={rate.maxUnits} onChange={e => edit({ maxUnits: Number(e.target.value) })} /></label>}
            {unit === "video_token" && <label className="field"><span>最大帧率</span><input type="number" min="1" max="120" value={rate.maxFramesPerSecond} onChange={e => edit({ maxFramesPerSecond: Number(e.target.value) })} /></label>}
          </div>
          {rate.tiers.map((tier, index) => <div className="price-tier" key={index}>
            <div className="form-grid"><label className="field"><span>{unit === "token" ? "输入 Token 上限" : pixelTiers ? "输出像素上限" : "分辨率"}</span><input value={unit === "token" ? tier.upToInputTokens ?? "" : pixelTiers ? tier.upToPixels ?? "" : tier.resolution ?? ""} onChange={e => edit({ tiers: rate.tiers.map((row, at) => at === index ? { ...row, ...(unit === "token" ? { upToInputTokens: Number(e.target.value) } : pixelTiers ? { upToPixels: Number(e.target.value) } : { resolution: e.target.value }) } : row) })} /></label>
            <CostField label="档位输入" micros={tokenCost ? tier.inputPerMillion : tier.inputUnitPrice} scale={config.scale} set={value => edit({ tiers: rate.tiers.map((row, at) => at === index ? { ...row, ...(tokenCost ? { inputPerMillion: value } : { inputUnitPrice: value }) } : row) })} />
            <CostField label="档位输出" micros={tokenCost ? tier.outputPerMillion : tier.outputUnitPrice} scale={config.scale} set={value => edit({ tiers: rate.tiers.map((row, at) => at === index ? { ...row, ...(tokenCost ? { outputPerMillion: value } : { outputUnitPrice: value }) } : row) })} /></div>
            {tier.audioInputPerMillion > 0 && <div className="form-grid"><CostField label="档位音频输入 · 每百万 Token" micros={tier.audioInputPerMillion} set={value=>edit({tiers:rate.tiers.map((row,at)=>at===index?{...row,audioInputPerMillion:value}:row)})}/><CostField label="档位音频缓存 · 每百万 Token" micros={tier.cachedAudioInputPerMillion ?? tier.audioInputPerMillion} set={value=>edit({tiers:rate.tiers.map((row,at)=>at===index?{...row,cachedAudioInputPerMillion:value}:row)})}/></div>}
            {tier.layered !== undefined && <label className="field"><span>生成方式</span><select value={String(tier.layered)} onChange={e=>edit({tiers:rate.tiers.map((row,at)=>at===index?{...row,layered:e.target.value==="true"}:row)})}><option value="false">单图生成</option><option value="true">图层拆分</option></select></label>}
            {unit === "video_token" && <div className="form-grid"><label className="field"><span>参考视频</span><select value={tier.videoInput === undefined ? "any" : String(tier.videoInput)} onChange={e => edit({ tiers: rate.tiers.map((row, at) => at === index ? { ...row, videoInput: e.target.value === "any" ? undefined : e.target.value === "true" } : row) })}><option value="any">不限</option><option value="false">不含视频</option><option value="true">含参考视频</option></select></label><label className="field"><span>预扣使用的最大帧像素</span><input type="number" min="1" value={tier.maxVideoPixels ?? ""} onChange={e => edit({ tiers: rate.tiers.map((row, at) => at === index ? { ...row, maxVideoPixels: Number(e.target.value) } : row) })} /></label></div>}
            <button type="button" onClick={() => edit({ tiers: rate.tiers.filter((_, at) => at !== index) })}>移除档位</button>
          </div>)}
          <button type="button" onClick={() => edit({ tiers: [...rate.tiers, { inputPerMillion: rate.inputPerMillion, outputPerMillion: rate.outputPerMillion, audioInputPerMillion: rate.audioInputPerMillion, cachedAudioInputPerMillion: rate.cachedAudioInputPerMillion, imageInputPerMillion: rate.imageInputPerMillion, inputUnitPrice: rate.inputUnitPrice, outputUnitPrice: rate.outputUnitPrice, ...(unit === "token" ? { upToInputTokens: rate.maxInputTokens } : pixelTiers ? { upToPixels: 4630000 } : { resolution: "1080P" }) }] })}>添加价格档位</button>
          <label><input type="checkbox" checked={rate.free} onChange={e => edit(e.target.checked ? { free: true, inputPerMillion: 0, outputPerMillion: 0, inputUnitPrice: 0, outputUnitPrice: 0, tiers: [] } : { free: false })} /> 确认为免费模型</label>
        </div>}
      </div>;
    })}</div>
    {visible.length > 50 && <small>显示前 50 项，请搜索具体模型</small>}
    <div className="model-add"><input aria-label="新模型 ID" placeholder="模型 ID" value={newId} onChange={e => setNewId(e.target.value)} /><button type="button" disabled={!newId.trim() || models.some(row => row.id === newId.trim())} onClick={() => { const id = newId.trim(); setModels([...models, { id, name: id, category, enabled: false, ...(category === "language" ? { contextWindow: 131072, maxTokens: 8192 } : {}) }]); setSelected(id); setNewId(""); }}>添加模型</button></div>
    {billing && <div className="form-grid"><label className="field"><span>价格来源</span><input type="url" value={billing.source} onChange={e => setBilling({ ...billing, source: e.target.value })} /></label><label className="field"><span>价格复核日期</span><input type="date" value={new Date(billing.validUntil).toISOString().slice(0, 10)} onChange={e => { if (e.target.value) setBilling({ ...billing, verifiedAt: Date.now(), validUntil: new Date(e.target.value + "T23:59:59Z").getTime() }); }} /></label></div>}
  </section>;
}

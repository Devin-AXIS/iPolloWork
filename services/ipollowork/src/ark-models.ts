/** Reviewed Ark model directory. Credentials and operator overrides remain in the service store. */
import { z } from "zod";
import { billingSchema, rateSchema, type ModelRate } from "./pricing.js";
import { serviceModelSchema, type ModelOperation } from "./model-catalog.js";
import { ServiceError } from "./errors.js";

export const arkProvider = "volcengine-video";
export const arkPriceSource = "https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing";
const voicePriceSource = "https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh";
const reviewedModels = [
  {"id": "doubao-seed-evolving", "name": "doubao-seed-evolving", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "doubao-seed-2-1-pro-260915", "name": "doubao-seed-2-1-pro-260915", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "doubao-seed-2-1-lite-260915", "name": "doubao-seed-2-1-lite-260915", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "doubao-seed-2-1-turbo-260628", "name": "doubao-seed-2-1-turbo-260628", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-1-pro-260628", "name": "doubao-seed-2-1-pro-260628", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-0-lite-260428", "name": "doubao-seed-2-0-lite-260428", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-0-mini-260428", "name": "doubao-seed-2-0-mini-260428", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-0-pro-260215", "name": "doubao-seed-2-0-pro-260215", "category": "language", "operation": "chat", "enabled": false, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-0-lite-260215", "name": "doubao-seed-2-0-lite-260215", "category": "language", "operation": "chat", "enabled": false, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-0-mini-260215", "name": "doubao-seed-2-0-mini-260215", "category": "language", "operation": "chat", "enabled": false, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-2-0-code-preview-260215", "name": "doubao-seed-2-0-code-preview-260215", "category": "language", "operation": "chat", "enabled": false, "contextWindow": 262144, "maxTokens": 8192},
  {"id": "doubao-seed-character-260628", "name": "doubao-seed-character-260628", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 131072, "maxTokens": 8192},
  {"id": "doubao-seed-character-251128", "name": "doubao-seed-character-251128", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 131072, "maxTokens": 8192},
  {"id": "doubao-seed-translation-250915", "name": "doubao-seed-translation-250915", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 4096, "maxTokens": 3072},
  {"id": "glm-5-3-flash-260828", "name": "glm-5-3-flash-260828", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "glm-5-2-260617", "name": "glm-5-2-260617", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "kimi-k3-1-pro-261024", "name": "kimi-k3-1-pro-261024", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "deepseek-v4-1-flash-261017", "name": "deepseek-v4-1-flash-261017", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "deepseek-v4-1-flash-260910", "name": "deepseek-v4-1-flash-260910", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "deepseek-v4-1-flash-economy-261017", "name": "deepseek-v4-1-flash-economy-261017", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "deepseek-v4-pro-ga-260813", "name": "deepseek-v4-pro-ga-260813", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "deepseek-v4-flash-ga-260731", "name": "deepseek-v4-flash-ga-260731", "category": "language", "operation": "chat", "enabled": true, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "deepseek-v4-pro-260425", "name": "deepseek-v4-pro-260425", "category": "language", "operation": "chat", "enabled": false, "contextWindow": 1048576, "maxTokens": 8192},
  {"id": "doubao-seedream-5-5-261028", "name": "doubao-seedream-5-5-261028", "category": "image", "operation": "image", "enabled": true},
  {"id": "doubao-seedream-5-0-pro-260628", "name": "doubao-seedream-5-0-pro-260628", "category": "image", "operation": "image", "enabled": true},
  {"id": "doubao-seedream-5-0-flash-260915", "name": "doubao-seedream-5-0-flash-260915", "category": "image", "operation": "image", "enabled": true},
  {"id": "doubao-seedream-5-0-260128", "name": "doubao-seedream-5-0-260128", "category": "image", "operation": "image", "enabled": false},
  {"id": "doubao-seedream-4-5-251128", "name": "doubao-seedream-4-5-251128", "category": "image", "operation": "image", "enabled": false},
  {"id": "doubao-seedream-4-0-250828", "name": "doubao-seedream-4-0-250828", "category": "image", "operation": "image", "enabled": false},
  {"id": "doubao-seedance-2-5-260628", "name": "doubao-seedance-2-5-260628", "category": "video", "operation": "video", "enabled": true},
  {"id": "doubao-seedance-2-0-260128", "name": "doubao-seedance-2-0-260128", "category": "video", "operation": "video", "enabled": true},
  {"id": "doubao-seedance-2-0-fast-260128", "name": "doubao-seedance-2-0-fast-260128", "category": "video", "operation": "video", "enabled": true},
  {"id": "doubao-seedance-2-0-mini-260615", "name": "doubao-seedance-2-0-mini-260615", "category": "video", "operation": "video", "enabled": true},
  {"id": "doubao-seedance-1-0-pro-250528", "name": "doubao-seedance-1-0-pro-250528", "category": "video", "operation": "video", "enabled": false},
  {"id": "doubao-seedance-1-0-pro-fast-251015", "name": "doubao-seedance-1-0-pro-fast-251015", "category": "video", "operation": "video", "enabled": false},
  {"id": "doubao-embedding-vision-251215", "name": "doubao-embedding-vision-251215", "category": "embedding", "operation": "embedding", "enabled": true},
  {"id": "doubao-embedding-vision-250615", "name": "doubao-embedding-vision-250615", "category": "embedding", "operation": "embedding", "enabled": false},
  {"id": "doubao-seed3d-2-0-260328", "name": "doubao-seed3d-2-0-260328", "category": "tool", "operation": "tool", "enabled": false},
  {"id": "hyper3d-gen2-260112", "name": "hyper3d-gen2-260112", "category": "tool", "operation": "tool", "enabled": false},
  {"id": "hitem3d-2-0-251223", "name": "hitem3d-2-0-251223", "category": "tool", "operation": "tool", "enabled": false},
] as const;
const scalarPrices: Record<string, readonly [number, number, number?]> = {
  "doubao-seed-evolving": [6, 30, 1.2], "doubao-seed-2-1-pro-260915": [6, 30, 1.2],
  "doubao-seed-2-1-pro-260628": [6, 30, 1.2], "doubao-seed-2-1-lite-260915": [.8, 2.7, .16],
  "doubao-seed-2-1-turbo-260628": [3, 15, .6], "doubao-seed-translation-250915": [1.2, 3.6],
  "glm-5-3-flash-260828": [.8, 2.8, .23], "glm-5-2-260617": [8, 28, 2],
  "kimi-k3-1-pro-261024": [13, 68, 1.3], "deepseek-v4-1-flash-261017": [2, 8, .04],
  "deepseek-v4-1-flash-260910": [2, 8, .04], "deepseek-v4-1-flash-economy-261017": [1.6, 6.4, .032],
  "deepseek-v4-pro-ga-260813": [9, 27, .3], "deepseek-v4-pro-260425": [9, 27, .3],
  "deepseek-v4-flash-ga-260731": [3, 9, .1],
};
const tierPrices: Record<string, readonly (readonly [number, number, number, number?])[]> = {
  pro: [[32768,3.2,16],[131072,4.8,24],[262144,9.6,48]],
  lite: [[32768,.6,3.6,9],[131072,.9,5.4,13.5],[262144,1.8,10.8,27]],
  mini: [[32768,.2,2,3],[131072,.4,4,6],[262144,.8,8,12]],
  character: [[32768,.8,2],[131072,1.2,6]],
};
const million = (value: number) => Math.round(value * 1_000_000);
function chatRate(model: typeof reviewedModels[number]): ModelRate | undefined {
  if (model.operation !== "chat" || !("contextWindow" in model)) return;
  const fixed = scalarPrices[model.id];
  const tierKey = model.id.startsWith("doubao-seed-character") ? "character" : /^doubao-seed-2-0-(pro|lite|mini|code)/.exec(model.id)?.[1];
  const tiers = tierKey ? tierPrices[tierKey === "code" ? "pro" : tierKey] : undefined;
  if (!fixed && !tiers) return;
  const [input, output, cached] = fixed ?? [tiers![tiers!.length-1][1],tiers![tiers!.length-1][2],undefined];
  return rateSchema.parse({ model: model.id, unit: "token", maxInputTokens: model.contextWindow, maxOutputTokens: model.maxTokens,
    inputPerMillion: million(input), outputPerMillion: million(output), cachedInputPerMillion: million(cached ?? input/5),
    ...(model.id === "doubao-seed-2-1-lite-260915" ? { audioInputPerMillion: million(12), cachedAudioInputPerMillion: million(2.4) } : {}),
    tiers: tiers?.map(([upToInputTokens,input,output,audio]) => ({ upToInputTokens,inputPerMillion:million(input),outputPerMillion:million(output),cachedInputPerMillion:million(input/5),audioInputPerMillion:million(audio??0),cachedAudioInputPerMillion:million((audio??0)/5) })),
  });
}

/** Reviewed rows are merged by model id; later operator edits are not overwritten. */
export const arkModelGroups = {
  chat: { title: "语言与多模态", category: "language", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", routes: [{method:"POST",path:"/chat/completions",points:0}],
    models: reviewedModels.filter(m=>m.operation==="chat").map(({operation:_operation,...model})=>model), rates: reviewedModels.flatMap(m=>{const rate=chatRate(m);return rate?[rate]:[];}) },
  embedding: { title: "文本与图像向量", category: "embedding", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", routes: [{method:"POST",path:"/embeddings/multimodal",points:0}],
    models: reviewedModels.filter(m=>m.operation==="embedding").map(({operation:_operation,...model})=>model), rates: reviewedModels.filter(m=>m.operation==="embedding").map(m=>rateSchema.parse({model:m.id,unit:"token",inputPerMillion:700000,imageInputPerMillion:1800000,maxInputTokens:131072,maxOutputTokens:1})) },
  image: { title: "Seedream 图像", category: "image", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", routes: [{method:"POST",path:"/images/generations",points:0}],
    models: reviewedModels.filter(m=>m.operation==="image").map(({operation:_operation,...model})=>model), rates: [
      ...[["doubao-seedream-5-0-flash-260915",.12],["doubao-seedream-4-5-251128",.25],["doubao-seedream-4-0-250828",.2]].map(([model,cost])=>rateSchema.parse({model,unit:"image",outputUnitPrice:million(Number(cost)),maxInputTokens:1,maxOutputTokens:1,maxUnits:15})),
      rateSchema.parse({model:"doubao-seedream-5-0-pro-260628",unit:"image",inputUnitPrice:20000,freeInputUnits:1,outputUnitPrice:600000,maxInputTokens:1,maxOutputTokens:1,maxUnits:17,tiers:[{upToPixels:2610000,layered:false,outputUnitPrice:300000},{upToPixels:Infinity,layered:false,outputUnitPrice:600000},{upToPixels:2610000,layered:true,outputUnitPrice:150000},{upToPixels:16777216,layered:true,outputUnitPrice:300000}].map(t=>({...t,inputUnitPrice:20000,upToPixels:t.upToPixels===Infinity?16777216:t.upToPixels}))}),
    ] },
  video: { title: "Seedance 视频", category: "video", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", routes: [{method:"POST",path:"/contents/generations/tasks",points:0,jobResultField:"id"},{method:"GET",path:"/contents/generations/tasks/:id",points:0}],
    models: reviewedModels.filter(m=>m.operation==="video").map(({operation:_operation,...model})=>model), rates: [["doubao-seedance-2-0-fast-260128",37,22],["doubao-seedance-2-0-mini-260615",23,14],["doubao-seedance-1-0-pro-250528",15,15],["doubao-seedance-1-0-pro-fast-251015",4.2,4.2]].map(([model,plain,reference])=>rateSchema.parse({model,unit:"video_token",maxInputTokens:1,maxOutputTokens:1,maxUnits:15,outputPerMillion:million(Number(plain)),tiers:[...["480p","720p"].flatMap(resolution=>[false,true].map(videoInput=>({resolution,videoInput,outputPerMillion:million(Number(videoInput?reference:plain)),maxVideoPixels:resolution==="480p"?691200:1555200}))),...(String(model).includes("1-0-pro")?[{resolution:"1080p",outputPerMillion:million(Number(plain)),maxVideoPixels:3499200}]:[])]})) },
  speech: { title: "语音合成与复刻音色", category: "audio", baseUrl: "https://openspeech.bytedance.com", routes: [{method:"POST",path:"/api/v3/tts/unidirectional/sse",points:0}],
    models: ["seed-tts-2.0","seed-icl-2.0"].map(id=>({id,name:id==="seed-tts-2.0"?"豆包语音合成 2.0":"豆包声音复刻 2.0（已注册音色）",category:"audio",enabled:true})),
    rates: ["seed-tts-2.0","seed-icl-2.0"].map(model=>rateSchema.parse({model,unit:"character",inputUnitPrice:300,maxInputTokens:1,maxOutputTokens:1,maxUnits:20000})) },
  transcription: { title: "语音识别", category: "audio", baseUrl: "https://openspeech.bytedance.com", routes: [{method:"POST",path:"/api/v3/auc/bigmodel/recognize/flash",points:0}],
    models: [{id:"volc.bigasr.auc_turbo",name:"豆包录音识别 · 极速版",category:"audio",enabled:true}], rates:[rateSchema.parse({model:"volc.bigasr.auc_turbo",unit:"audio_hour",inputUnitPrice:800000,maxInputTokens:1,maxOutputTokens:1,maxUnits:7200})] },
  "transcription-file": { title: "长音频识别", category: "audio", baseUrl: "https://openspeech.bytedance.com", routes: [{method:"POST",path:"/api/v3/auc/bigmodel/submit",points:0,jobResultField:"task_id"},{method:"POST",path:"/api/v3/auc/bigmodel/query",points:0,jobField:"task_id"}],
    models:[{id:"volc.seedasr.auc",name:"豆包录音识别 2.0 · 标准版",category:"audio",enabled:true}],rates:[rateSchema.parse({model:"volc.seedasr.auc",unit:"audio_hour",inputUnitPrice:800000,maxInputTokens:1,maxOutputTokens:1,maxUnits:18000})] },
  audio: { title: "音频创作", category: "audio", baseUrl: "https://openspeech.bytedance.com", routes: [{method:"POST",path:"/api/v3/tts/create",points:0}],
    models:[{id:"seed-audio-1.0",name:"Seed Audio 1.0 · 配音、音乐与音效",category:"audio",enabled:true}],rates:[rateSchema.parse({model:"seed-audio-1.0",unit:"audio_minute",outputUnitPrice:1000000,maxInputTokens:1,maxOutputTokens:1,maxUnits:120})] },
  tool: { title: "其他模型", category: "tool", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", routes: [],
    models:reviewedModels.filter(m=>m.operation==="tool").map(({operation:_operation,...model})=>model),rates:[] },
} as const;

/** Return the existing group id, preserving installed image/video service choices. */
export function arkServiceId(operation: string): string { return "official-volcengine-" + operation; }

/** Create validated prices for a group. Unknown protocols have no billable routes. */
export function arkBilling(operation: keyof typeof arkModelGroups) {
  const group=arkModelGroups[operation];
  if (!group.rates.length) return undefined;
  const speech=["speech","transcription","transcription-file","audio"].includes(operation);
  return billingSchema.parse({kind:operation.startsWith("transcription")?"audio":operation==="tool"?"request":operation,protocol:speech?"volcengine-speech":"ark",source:speech?voicePriceSource:arkPriceSource,verifiedAt:Date.UTC(2026,10,14),validUntil:Date.UTC(2026,11,14),rates:group.rates,maxInputVideoSeconds:30});
}

const directorySchema = z.object({object:z.literal("list"),data:z.array(z.object({id:z.string().min(1).max(200),name:z.string().optional(),domain:z.string(),task_type:z.array(z.string()).default([]),token_limits:z.object({context_window:z.number().int().nonnegative(),max_output_token_length:z.number().int().nonnegative()}).optional(),max_output_tokens:z.number().int().nonnegative().optional(),api_supported:z.record(z.string(),z.unknown()).optional(),modalities:z.object({input_modalities:z.array(z.string()).default([]),output_modalities:z.array(z.string()).default([])}).optional()})).max(5000)});
/** Decode every visible Ark model. Unsupported protocols remain disabled in Other models. */
export function parseArkModels(raw: unknown): {total:number;items:{model:z.infer<typeof serviceModelSchema>;operation:ModelOperation}[]} {
  const page=directorySchema.parse(raw),seen=new Set<string>();
  const items=page.data.map(entry=>{
    if(seen.has(entry.id))throw new ServiceError("SERVICE_DISCOVERY_INCOMPLETE",503);
    seen.add(entry.id);
    const operation:ModelOperation=entry.domain==="LLM"||entry.domain==="VLM"?"chat":entry.domain==="ImageGeneration"?"image":entry.domain==="VideoGeneration"?"video":entry.domain==="Embedding"?"embedding":"tool";
    const category=operation==="chat"?"language":operation;
    const limits=entry.token_limits;
    const model=serviceModelSchema.parse({id:entry.id,name:entry.name??entry.id,category,enabled:false,capabilities:[...entry.task_type,...(entry.modalities?.input_modalities.map(m=>"input:"+m)??[])],...(operation==="chat"?{contextWindow:limits?.context_window,maxTokens:entry.max_output_tokens??limits?.max_output_token_length}:{})});
    return {model,operation};
  });
  return {total:items.length,items};
}

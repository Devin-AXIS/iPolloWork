import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hyperframesMotionRecipeSchema } from "../../../packages/types/src/hyperframes.ts";

// Reviewed, authored conversions only. Never infer a port from a card or preview name.
const repository = "https://github.com/louiseliu/hyperFrames-video-shotcraft";
const revision = "1df77f1ab080323558f70a5fb880fad0f88f87fc";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../registry");
const catalog: { conversionRevision: string; cards: { name: string; sourcePath: string; rules: string; styles: { key: string; conversion: { status: string; path: string | null } }[] }[] } = JSON.parse(await readFile(join(root, "shotcraft-references.json"), "utf8"));
if (catalog.conversionRevision !== revision) throw Error("Shotcraft conversion revision changed; review the source mappings first.");

type TextInput = { id: string; value: string; limit: number; lines?: number };
type Port = { key: string; title: string; use: string; avoid: string; inputs: TextInput[]; ranges: [number, number, string][]; words?: { count: number; length: number }; media?: boolean };
const input = (id: string, value: string, limit: number, lines = 1): TextInput => ({ id, value, limit, lines });
const ports: Port[] = [
  { key: "glitch-cycle", title: "状态乱码锁定轮播", use: "逐项说明同一任务的四个状态，最后锁定完成态。", avoid: "不展示真实运行日志；不用乱码承载关键数据或长段文字。", inputs: [input("words", "准备素材|检查输入|生成画面|制作完成", 23)], words: { count: 4, length: 5 }, ranges: [[0, 1.4, "建立第一个状态"], [1.4, 2.8, "切换第二个状态"], [2.8, 4.2, "切换第三个状态"], [4.2, 5.6, "锁定最后的状态"]] },
  { key: "gradient-word-sweep", title: "关键词渐变扫光", use: "让一个短关键词由白字到渐变填充，并在副句中限定含义。", avoid: "不是数据变化或证据高亮；不把光效当成性能提升的证据。", inputs: [input("title", "更快交付", 8), input("suffix", "从瓶颈开始", 10), input("subtitle", "先定位限制，再验证改善", 20)], ranges: [[0, .4, "建立标题"], [.4, 1.1, "填充关键词"], [1.1, 2.9, "扫光并落定"]] },
  { key: "lead-word-zoom-assemble", title: "首词退镜组句", use: "先强调句首概念，再退镜组装三段短标题和解释。", avoid: "不是长句字幕；不得隐藏重要限定词或把退镜当实景运镜。", inputs: [input("words", "发现|流程|瓶颈", 17), input("subtitle", "先找限制，再决定加在哪里", 24)], words: { count: 3, length: 5 }, ranges: [[0, .4, "强调句首概念"], [.4, 1.2, "退镜组装短句"], [1.2, 1.7, "抬起标题显示解释"]] },
  { key: "pill-chip-slot-cycle-handled", title: "胶囊槽位职责轮播", use: "同一固定语句中轮播四个具体职责，说明覆盖范围。", avoid: "不是已发生的处理过程或真实 UI 操作；不把文字胶囊冒充产品截图。", inputs: [input("prefix", "负责", 4), input("suffix", "处理", 4), input("words", "素材|排版|旁白|验收", 19)], words: { count: 4, length: 4 }, ranges: [[1.25, 2.35, "从首项切换第二个职责"], [2.35, 3.45, "切换第三个职责"], [3.45, 4.05, "落定第四个职责"]] },
  { key: "pill-slot-cycle", title: "功能胶囊逐项切换", use: "在固定句式下依次展示六项功能，再收束成一句范围说明。", avoid: "不是流程、能力评分或已经执行的功能证明。", inputs: [input("prefix", "用来", 5), input("words", "提出问题|寻找依据|整理资料|形成初稿|检查结果|完成交付", 53), input("result", "完成这件事", 7)], words: { count: 6, length: 8 }, ranges: [[0, .4, "建立共同句式"], [.4, 4.6, "轮播六项功能"], [4.6, 5.066667, "落定范围说明"]] },
  { key: "scramble", title: "短标题乱码解码", use: "将未知问题锁定为一个清晰短标题，表达揭晓。", avoid: "不模拟密码破解、真实计算或事实验证；不要每幕重复。", inputs: [input("title", "瓶颈在哪里", 10)], ranges: [[0, 3.2, "乱码逐字锁定为标题"]] },
  { key: "split-flap-title", title: "机械翻牌标题", use: "用机械翻牌揭晓一个短标题或章节词。", avoid: "不用于需连续阅读的解释段落；翻牌随机字符不代表数据。", inputs: [input("title", "找到瓶颈", 10)], ranges: [[.733333, 2.8, "逐格翻转锁定标题"]] },
  { key: "text-column-converge", title: "文字列切换汇合", use: "在同一前缀下切换九个短主题，最后与末项汇合成标题。", avoid: "不是九步执行流程；不把快速切词用于解释陌生专业术语。", inputs: [input("prefix", "关注", 3), input("words", "需求|输入|素材|分镜|排版|旁白|动效|验收|交付", 62), input("subtitle", "以实际结果为准", 20)], words: { count: 9, length: 6 }, ranges: [[0, 3.266667, "轮播共同主题"], [3.266667, 5.266667, "两列汇合并显示限定"]] },
  { key: "title-demote-to-label", title: "主标题降级为页签", use: "在真实页面素材上演示两个章节标题从主体降为阅读标签。", avoid: "必须有同一主题的真实页面素材；不是模拟真实产品交互。", inputs: [input("title", "先找出问题", 10), input("secondTitle", "再检查结果", 10)], media: true, ranges: [[0, 3.066667, "第一个标题降级为标签"], [3.066667, 6.4, "选择第二个标题并降级"]] },
  { key: "split-text-stagger", title: "字符错峰上升", use: "一个短标题按字符错峰上升并落定，适合章节入场。", avoid: "不是词级字幕；不拆散长段解释或给证据文字制造跳动。", inputs: [input("title", "把问题讲清楚", 10), input("label", "理解流程", 16)], ranges: [[0, 2.2, "字符错峰上升并归位"]] },
  { key: "drift-assembly", title: "字符漂移组装", use: "分散字符沿原漂移路径组装成短标题，表达聚合与整理。", avoid: "不是节点关系或因果图；组装文字不能声称完成真实任务。", inputs: [input("title", "整理成结论", 8), input("label", "从线索到判断", 16)], ranges: [[0, 2.466667, "字符漂移到各自槽位"], [2.466667, 3.5, "落定并完成一次呼吸"]] },
  { key: "text-on-path", title: "字符沿路径归位", use: "短标题字符沿一条曲线行进，再回到水平基线。", avoid: "路径只是文字入场，不代表增长曲线、地理线路或真实轨迹。", inputs: [input("title", "找到下一步", 12), input("label", "沿线理解", 16)], ranges: [[0, 3.4, "字符沿曲线进入并归位为水平标题"]] },
  { key: "font-weight-pump", title: "字重节拍强调", use: "用五次已标定的节拍或语义强调改变同一短词的字重。", avoid: "没有实测音乐或旁白锚点时不能宣称卡点；不持续震动解释文字。", inputs: [input("title", "关注瓶颈", 8)], ranges: [[.8, 1.333333, "第一次强调"], [1.466667, 2, "第二次强调"], [2.133333, 2.666667, "第三次强调"], [2.8, 3.333333, "第四次强调"], [3.466667, 4, "第五次强调"]] },
  { key: "terminal-typewriter", title: "命令打字进入真实页面", use: "展示一条明确的命令示例，推进后切到对应真实截图。", avoid: "不得暗示命令实际成功执行；必须提供对应页面素材，不绘制假仪表盘。", inputs: [input("command", "pnpm build", 20), input("context", "示例命令，不代表已执行", 24)], media: true, ranges: [[0, 1.933333, "展示并输入命令"], [1.933333, 2.3, "推进到对应真实页面"]] },
  { key: "error-retype", title: "文字删除重写", use: "同一前缀下输入一个表述，删除后改写为更准确的表述。", avoid: "不伪造真实用户输入或改写原始引用；必须保留原意和修订边界。", inputs: [input("prefix", "先", 2), input("before", "继续加人", 6), input("after", "找到瓶颈", 6)], ranges: [[0, 2.266667, "输入原表述并删除后缀"], [2.266667, 3.8, "输入修订后缀并停下光标"]] },
  { key: "typing-code-block", title: "代码逐行与逐字对照", use: "用同一段真实代码对比逐行呈现与逐字输入，最多四行。", avoid: "不是代码运行证明；不使用演示代码替代用户源码或声称已验证结果。", inputs: [input("code", "const cap = 30;\nconst need = 45;\nconst gap = need-cap;\n// gap: 15", 22, 4)], ranges: [[0, 4.6, "左侧逐行呈现，右侧逐字输入同一代码"]] },
  { key: "vertical-word-roll-blur-cycle", title: "纵向词列滚动聚焦", use: "在共同前缀下依次聚焦四个短词，最后保留末项。", avoid: "不是排行榜或优先级变化；模糊邻词只能作上下文，不承载关键证据。", inputs: [input("prefix", "适合", 4), input("words", "写稿|审核|发布|协作", 19)], words: { count: 4, length: 4 }, ranges: [[.8, 1.8, "从首词聚焦第二个词"], [1.8, 2.8, "聚焦第三个词"], [2.8, 3.35, "聚焦并保留末词"]] },
  { key: "word-relay-filmstrip", title: "真实页面胶片词语接力", use: "同一真实页面的胶片滚动与三个关联动词同步接力。", avoid: "只支持同一素材反复经过，不宣称是三个不同页面；不使用假代码骨架。", inputs: [input("prefix", "团队", 4), input("words", "观察|判断|行动", 17)], words: { count: 3, length: 5 }, media: true, ranges: [[0, 1.033333, "第一页进入并显示首词"], [1.033333, 2.6, "胶片推进并接力第二个词"], [2.6, 4.2, "第三个词接力并落定"]] },
  { key: "word-relay-geometry", title: "几何衬托关键词接力", use: "三个短关键词依次接力，以装饰圆形和填色形成强调层级。", avoid: "几何形状不是测量、关系图或真实指标；不把三个词当完整解释。", inputs: [input("words", "看见|理解|行动", 17)], words: { count: 3, length: 5 }, ranges: [[0, 1.92, "圆形衬托首词"], [1.92, 3.84, "切换并填充第二个词"], [3.84, 6, "最后一个词锁定为白字"]] },
];

function replace(source: string, before: string | RegExp, after: string): string {
  if (typeof before === "string" ? !source.includes(before) : !before.test(source)) throw Error("Reviewed source anchor is missing: " + before);
  return source.replace(before, () => after);
}

function adapt(source: string, key: string): string {
  const text = (name: string) => "String(values." + name + ")";
  const words = "String(values.words).split('|')";
  switch (key) {
    case "glitch-cycle": return replace(source, /const PHRASES = \[[^;]+;/, "const PHRASES = " + words + ";");
    case "gradient-word-sweep":
      for (const [literal, name] of [["Supercharged", "title"], ["performance", "suffix"], ["with rock-solid reliability", "subtitle"]]) source = source.replaceAll(literal, "${escape(" + text(name) + ")}");
      return source;
    case "lead-word-zoom-assemble":
      source = replace(source, "TEXT='Introducing Lumen Deck', HIGHLIGHT='Lumen'", "TEXT=" + words + ".join(' '), HIGHLIGHT=" + words + "[0]");
      source = replace(source, "SUBLINE='One shot card, one motion recipe — copy, paste, render.'", "SUBLINE=" + text("subtitle"));
      source = replace(source, "const innerScale=1+crash*CRASH_SCALE, innerBlur=crash*CRASH_BLUR, innerOp=1-crash*0.55;", "const innerScale=1, innerBlur=0, innerOp=1; // Preserve readable Land; original crash is an optional outgoing transition, not a mandatory ending.");
      source = replace(source, '<div style="transform:scale(${innerScale});', '<div style="position:absolute;inset:0;transform:scale(${innerScale});');
      source = replace(source, "lineWidth=960", "lineWidth=measure(TEXT, '600 96px -apple-system, sans-serif')");
      return source.replaceAll("${word}", "${escape(word)}").replaceAll("${SUBLINE}", "${escape(SUBLINE)}");
    case "pill-chip-slot-cycle-handled":
      source = replace(source, /const WORDS=\[[^;]+;/, "const WORDS=" + words + ".map(w=>({w,e:'•'}));");
      source = replace(source, "const widths=[139,178,145,171]", "const widths=WORDS.map(({w})=>measure(w, '700 22px -apple-system, sans-serif')+68)");
      return source.replaceAll(">Your</div>", ">${escape(String(values.prefix))}</div>").replaceAll(">Handled</div>", ">${escape(String(values.suffix))}</div>").replaceAll("${label}", "${escape(label)}").replaceAll("${w}", "${escape(w)}");
    case "pill-slot-cycle":
      source = replace(source, /const PILLS=\[[^;]+;/, "const PILLS=" + words + ".map(label=>({label,icon:'•'}));");
      return source.replaceAll(">One AI tool to</span>", ">${escape(String(values.prefix))}</span>").replaceAll(">do it all.</span>", ">${escape(String(values.result))}</span>").replaceAll("${label}", "${escape(label)}");
    case "scramble":
      source = replace(source, "TEXT='TEMPLATE MOTION DEMO'", "TEXT=" + text("title"));
      return source.replaceAll("content===' '?'&nbsp;':content", "content===' '?'&nbsp;':escape(content)");
    case "split-flap-title":
      source = replace(source, "TEXT='SHIP FASTER'", "TEXT=" + text("title"));
      source = replace(source, '<div style="position:absolute;left:0;top:${part===', '<div data-ipw-flap-half style="position:absolute;left:0;top:${part===');
      return source.replaceAll("${ch}", "${escape(ch)}");
    case "text-column-converge":
      source = replace(source, /const STEPS=\[[^;]+;/, "const STEPS=" + words + ".map((word,i)=>({word,dur:[16,12,9,8,7,8,10,12,999][i]}));");
      source = replace(source, "MERGED_LEFT=960-LINE_W/2,MERGED_RIGHT=960+LINE_W/2", "MERGED_LEFT=960-(measure(String(values.prefix),'500 42px monospace')+measure(STEPS[8].word,'500 42px monospace')+3*(String(values.prefix).length+STEPS[8].word.length)+24)/2,MERGED_RIGHT=960+(measure(String(values.prefix),'500 42px monospace')+measure(STEPS[8].word,'500 42px monospace')+3*(String(values.prefix).length+STEPS[8].word.length)+24)/2");
      return source.replaceAll(">NEW</div>", ">${escape(String(values.prefix))}</div>").replaceAll(">COMING 2026</div>", ">${escape(String(values.subtitle))}</div>").replaceAll("${cur.word}", "${escape(cur.word)}");
    case "title-demote-to-label":
      source = replace(source, /const skeleton=\(t\)=>\{[\s\S]*?\}\)\.join\(''\);\};/, "const skeleton=t=>`<img src=\"${escape(String(values.mediaUrl))}\" style=\"width:1500px;height:780px;object-fit:contain;opacity:${t};transform:translateY(${(1-t)*28}px)\">`;");
      return source.replaceAll("'Running Subagents'", text("title")).replaceAll("'Select the Answer'", text("secondTitle")).replaceAll("${title}", "${escape(title)}");
    case "split-text-stagger":
      source = replace(source, "TEXT='MOTION SYSTEM'", "TEXT=" + text("title"));
      source = replace(source, "let t=(f-t0)/RISE", "let t=Math.min(1,Math.max(0,(f-t0)/RISE))");
      source = replace(source, "let t=(f-t0-RISE)/SETTLE", "let t=Math.min(1,Math.max(0,(f-t0-RISE)/SETTLE))");
      return source.replaceAll("SPLIT TEXT STAGGER</div>", "${escape(String(values.label))}</div>").replaceAll("c===' '?'&nbsp;':c", "c===' '?'&nbsp;':escape(c)");
    case "drift-assembly":
      source = replace(source, "WORD='ASSEMBLE'", "WORD=" + text("title"));
      return source.replaceAll("LETTERFORM DRIFT ASSEMBLY</div>", "${escape(String(values.label))}</div>").replaceAll("${c}</span>", "${escape(c)}</span>");
    case "text-on-path":
      source = replace(source, "TEXT='GROWTH ALL THE WAY'", "TEXT=" + text("title"));
      source = replace(source, "CHAR_W=46", "CHAR_W=76");
      return source.replaceAll("TEXT ON PATH</div>", "${escape(String(values.label))}</div>").replaceAll("${ch}</div>", "${escape(ch)}</div>");
    case "font-weight-pump": return source.replaceAll(">PUMP IT UP</div>", ">${escape(String(values.title))}</div>");
    case "terminal-typewriter":
      source = replace(source, "CMD='acme deploy --prod'", "CMD=" + text("command"));
      source = replace(source, /const fakeDash=\(\)=>`[\s\S]*?`;\n/, "const fakeDash=()=>`<img src=\"${escape(String(values.mediaUrl))}\" style=\"width:1920px;height:1080px;object-fit:contain\">`;\n");
      return source.replaceAll("~/acme-app (main)</div>", "${escape(String(values.context))}</div>").replaceAll("${CMD.substring(0,chars)}", "${escape(CMD.substring(0,chars))}");
    case "error-retype":
      source = replace(source, "TEXT1='just a dashboard',KEEP=5", "TEXT1=" + text("prefix") + "+" + text("before") + ",KEEP=String(values.prefix).length");
      source = replace(source, "TEXT2='your command center'", "TEXT2=" + text("after"));
      source = replace(source, "CHAR_W=58", "CHAR_W=100");
      return source.replaceAll("c===' '?'&nbsp;':c", "c===' '?'&nbsp;':escape(c)");
    case "typing-code-block":
      source = replace(source, /const LINES=\[[^\n]+;/, "const LINES=String(values.code).replaceAll('\\\\n','\\n').split('\\n').map(line=>[[line,ID]]);");
      source = replace(source, "font-size:12px;line-height:1.9", "font-size:8px;line-height:1.9");
      return source.replaceAll("${txt}</span>", "${escape(txt)}</span>").replaceAll("${c.ch}</span>", "${escape(c.ch)}</span>").replaceAll("'LINE FADE-IN'", "'逐行展示'").replaceAll("'CHAR TYPING'", "'逐字输入'");
    case "vertical-word-roll-blur-cycle":
      source = replace(source, "WORDS=['Apps','Teams','Data','Everyone']", "WORDS=" + words);
      source = replace(source, "const fade=1-seg(t,0.9,0.985)*0.999;", "const fade=1; // Land keeps the last word readable instead of fading the whole scene away.");
      return source.replaceAll(">Built for</div>", ">${escape(String(values.prefix))}</div>").replaceAll("${w}</div>", "${escape(w)}</div>");
    case "word-relay-filmstrip":
      source = replace(source, "WORDS=['researches','builds','codes']", "WORDS=" + words);
      source = replace(source, /const cardShell=\(y,i\)=>`[\s\S]*?`;\n/, "const cardShell=(y,i)=>`<div style=\"position:absolute;top:${y}px;left:106px;width:${CARD_W}px;height:${CARD_H}px;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(30,26,20,.14)\"><img src=\"${escape(String(values.mediaUrl))}\" style=\"width:100%;height:100%;object-fit:contain\"></div>`;\n");
      return source.replaceAll(">Computer</div>", ">${escape(String(values.prefix))}</div>").replaceAll("${w}</div>", "${escape(w)}</div>");
    case "word-relay-geometry":
      source = replace(source, "label:'Faster'", "label:" + words + "[0]");
      source = replace(source, "label:'Better'", "label:" + words + "[1]");
      source = replace(source, "label:'Stronger'", "label:" + words + "[2]");
      source = replace(source, "line-height:1;position:relative", "line-height:1.3;white-space:nowrap");
      return source.replaceAll("${label}", "${escape(label)}");
    default: throw Error("No reviewed source adapter: " + key);
  }
}

const license = await readFile(join(root, "shotcraft-reference-LICENSE.txt"), "utf8");
const files = new Map<string, string>();
for (const port of ports) {
  const card = catalog.cards.find(card => card.styles.some(style => style.key === port.key));
  const conversion = card?.styles.find(style => style.key === port.key)?.conversion;
  if (!card || !conversion?.path || conversion.status !== "authored-unverified") throw Error("Unreviewed or missing conversion " + port.key);
  const response = await fetch(repository.replace("https://github.com/", "https://raw.githubusercontent.com/") + "/" + revision + "/" + conversion.path);
  if (!response.ok) throw Error(conversion.path + ": " + response.status);
  const source = await response.text();
  if (source.includes("TODO: Port animation logic") || !/\btl\.to\(/.test(source)) throw Error("Placeholder or missing source timeline: " + port.key);
  const id = "shotcraft-" + port.key;
  const oldId = source.match(/data-composition-id="([^"]+)"/)?.[1];
  if (!oldId) throw Error("Composition ID missing: " + port.key);
  const values = Object.fromEntries(port.inputs.map(field => [field.id, field.value]));
  if (port.media) values.mediaUrl = "assets/evidence.svg";
  const variables = [...port.inputs.map(field => ({ id: field.id, label: field.id, type: "string", default: field.value, maxLength: field.limit * (field.lines ?? 1) + (field.lines ?? 1) - 1, update: "reload" })), ...(port.media ? [{ id: "mediaUrl", label: "真实页面素材", type: "string", default: values.mediaUrl, maxLength: 2000, update: "reload" }] : []), { id: "motionCueTimes", label: "实测语义时间", type: "string", default: "{}", maxLength: 2048, update: "reload" }];
  let cursor = .65;
  const events = port.ranges.map(([from, to, action], index) => {
    const event = { id: "phase-" + (index + 1), target: ".sc-content *", time: cursor, duration: to - from, action };
    cursor += event.duration;
    return event;
  });
  const duration = Math.ceil((cursor + 1) * 30) / 30;
  const recipe = hyperframesMotionRecipeSchema.parse({ version: 1, pattern: "kinetic-type", minHoldSeconds: .7,
    ...(port.words ? { capacity: { variable: "words", separator: "|", minItems: port.words.count, maxItems: port.words.count, fieldSeparator: "::", fieldsPerItem: 1, maxFieldLength: port.words.length } } : {}),
    textLimits: Object.fromEntries(port.inputs.filter(field => field.id !== "words").map(field => [field.id, { maxLines: field.lines ?? 1, maxLineLength: field.limit }])), events,
    usage: { useWhen: [port.use], avoidWhen: [port.avoid, "文字动效不是图表或执行证明；不要为了使用特效改写事实。"],
      inputRules: { ...Object.fromEntries(port.inputs.map(field => [field.id, field.id === "words" ? `恰好${port.words?.count}项，用 | 分隔；每项最多${port.words?.length}字，不能含 ::；按真实叙事顺序提供。` : `提供真实${field.id}，最多${field.lines ?? 1}行，每行${field.limit}字，不使用演示默认内容。`])), ...(port.media ? { mediaUrl: "当前项目 assets/ 中已有的真实页面图片，必须与讲述内容对应。演示 SVG 仅用于测试，不是交付素材。" } : {}) },
      readingOrder: ["建立共同主题", ...port.ranges.map(range => range[2]), "停留在完整可读的落定状态"].slice(0, 8),
      cueBindings: Object.fromEntries(events.map(event => [event.id, "绑定实测旁白或音乐中与“" + event.action + "”对应的短语或节拍；保留内部曲线，不按字数伪造精确对齐。"])),
      fallback: { overflow: "按语义拆镜或换配方；禁止截断和缩到不可读。", missingInput: "补真实内容与素材；不要使用源码里的演示文案或模拟 UI。", timingMismatch: "按实测时间重绑事件，保留各阶段动作比例和最终停留；过长旁白拆镜。", inapplicable: "优先选择适用的可执行配方；确需定制时说明具体合同或语义缺口，不冒充复用。" },
      example: { values, narration: port.inputs.map(field => field.value.replaceAll("|", "，")).join("。") },
      acceptance: ["各阶段实际执行原转换版运动函数；正放、倒放与直接跳转得到同一状态。", "真实中文在容量边界上不裁切重要文字；最后保持完整可读，不留白屏。", "实测锚点控制可见阶段，不能只写元数据；提供真实素材，不保留演示身份。", "不宣称逐像素等同原片；保留输入、页面几何与文字安全修正的说明。"] } });
  const prologue = `(async function(){await document.fonts.ready;const host=document.querySelector('[data-composition-id="${id}"]');const values={...${JSON.stringify(values)},...(window.__hyperframes?.getVariables?.()??{}),...(window.__hfVariablesByComp?.[host.dataset.compositionId]??{})};const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');const measure=(text,font)=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=font;return ctx.measureText(text).width;};${port.media ? "const media=new Image();media.src=String(values.mediaUrl);await media.decode();" : ""}\n`;
  let html = adapt(source, port.key).replaceAll(oldId, id);
  if (!/<div\s+data-composition-id="[^"]+"[\s\S]*?data-height="1080"[^>]*>/.test(html)) throw Error("Missing fixed canvas: " + port.key);
  html = html.replace(/(<div\s+data-composition-id="[^"]+"[\s\S]*?data-height="1080"[^>]*>)/, "$1<div class=\"sc-content\">");
  html = replace(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^>]+>/, "</div><script src=\"https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js\">");
  // id=comp was on the composition root in some sources; keep drawing inside the content wrapper.
  if (html.includes('id="comp"')) html = html.replace(' id="comp"', '').replace('<div class="sc-content">', '<div class="sc-content" id="comp">');
  html = html.replace(/data-duration="[^"]+"/, 'data-duration="' + duration + '"');
  html = replace(html, "<script>\n", "<script data-ipw-motion-recipe=\"1\">\n" + prologue);
  const adapter = `\nconst motionStyle=JSON.parse(String(values.motionStyle??'{"durationFactor":1}'));\nconst recipe=${JSON.stringify(recipe)},ranges=${JSON.stringify(port.ranges)},cues=JSON.parse(String(values.motionCueTimes??'{}')),native=window.__timelines[host.dataset.compositionId];host.__sourceTimeline=native;const stateClock={time:0};const clockEnd=Math.max(${duration},...recipe.events.map(event=>(cues[event.id]??event.time)+event.duration*motionStyle.durationFactor+4));const master=gsap.timeline({paused:true});const render=()=>{let sourceTime=0;for(let i=0;i<recipe.events.length;i++){const event=recipe.events[i],start=cues[event.id]??event.time,length=event.duration*motionStyle.durationFactor,[from,to]=ranges[i];if(stateClock.time<start)break;sourceTime=from+(to-from)*Math.min(1,(stateClock.time-start)/length);}native.render(Math.max(0.000001,sourceTime),false,true);host.dataset.ipwSourceTime=String(sourceTime);};master.to(stateClock,{time:clockEnd,duration:clockEnd,ease:'none',onUpdate:render},0);window.__timelines[host.dataset.compositionId]=master;render();})();\n`;
  html = replace(html, "</script>\n</body>", adapter + "</script>\n</body>");
  html = html.replace('<div data-composition-id="' + id + '"', '<div data-ipw-source-ranges="' + JSON.stringify(port.ranges).replaceAll('"', '&quot;') + '" data-composition-id="' + id + '"');
  const css = `html,body{margin:0;width:1920px;height:1080px;overflow:hidden}[data-composition-id="${id}"]{position:relative;width:1920px;height:1080px}.sc-content{position:absolute;inset:0;font-family:var(--ipw-font-display,-apple-system,"PingFang SC",sans-serif)}${port.key === "gradient-word-sweep" ? ".sc-content{display:flex;flex-direction:column;align-items:center;justify-content:center}" : ""}`;
  html = html.replace("</style>", css + "</style>");
  html = html.replace("<head>", '<head><script type="application/json" data-composition-variables="' + JSON.stringify(variables).replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></script>');
  const manifest = { $schema: "https://hyperframes.heygen.com/schema/registry-item.json", name: id, version: "1.0.0", type: "hyperframes:block", title: port.title, description: port.use, tags: ["component", "shotcraft", "typography", "theme"], author: "Wei Yihao; louiseliu conversion; iPolloWork integration", license: "Apache-2.0",
    upstream: { repository, revision, implementation: conversion.path, rules: card.sourcePath, license: "Apache-2.0", upstreamSha256: createHash("sha256").update(source).digest("hex"), adaptation: "Retains converted GSAP/frame functions. Modified: escaped real content, measured stage cues, Chinese geometry, clamped character settling, readable final hold; real screenshots replace demo skeletons. Does not certify pixel parity.", referenceGallery: repository + "/tree/" + revision + "/gallery" },
    source: { provider: "hyperframes-video-shotcraft", label: "HyperFrames Shotcraft · Apache-2.0", url: repository + "/blob/" + revision + "/" + card.sourcePath },
    visualComponent: { version: 1, category: "typography", surfaces: ["video"], themeMode: "inherit", ai: { slots: Object.keys(values), instructions: port.use + " " + port.avoid } }, dimensions: { width: 1920, height: 1080 }, duration, engine: { name: "gsap", version: "3.14.2", seekable: true },
    files: [{ path: id + ".html", target: "compositions/" + id + ".html", type: "hyperframes:composition" }, { path: "LICENSE", target: "compositions/licenses/hyperframes-video-shotcraft-LICENSE.txt", type: "hyperframes:asset" }], variables, motionRecipe: recipe };
  const directory = join(root, "blocks", id);
  for (const [name, content] of [[id + ".html", html], ["registry-item.json", JSON.stringify(manifest, null, 2) + "\n"], ["upstream.html", source], ["upstream-card.md", card.rules], ["LICENSE", license]]) files.set(join(directory, name), content);
}

// Validate every source and adapter before changing any owned file.
for (const [path, content] of files) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); }
const index = JSON.parse(await readFile(join(root, "registry.json"), "utf8"));
for (const port of ports) if (!index.items.some((item: { name: string }) => item.name === "shotcraft-" + port.key)) index.items.push({ name: "shotcraft-" + port.key, type: "hyperframes:block" });
await writeFile(join(root, "registry.json"), JSON.stringify(index, null, 2) + "\n");
console.log("Imported 19 reviewed typography conversions. Generate recipe cards and run rendered acceptance before reporting them as verified.");

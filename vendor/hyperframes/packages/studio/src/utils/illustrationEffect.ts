export const ILLUSTRATION_EFFECT_IDS = [
  "ian-xiaohei-illustrations",
  "html-infographic",
  "html-concept-explainer",
  "html-kinetic-typography",
  "html-svg-path",
  "html-3d-space",
] as const;

export type IllustrationEffectId = (typeof ILLUSTRATION_EFFECT_IDS)[number];

export interface IllustrationEffectData {
  title: string;
  subtitle: string;
  eyebrow: string;
  detail: string;
  sourceLabel: string;
  sourceKind: string;
  duration: number;
}

export interface IllustrationEffectDefinition {
  id: IllustrationEffectId;
  title: { en: string; zh: string };
  description: { en: string; zh: string };
  repository: string;
}

export function selectIllustrationTextCandidates(
  values: Array<string | null | undefined>,
  maxLength = 160,
): string[] {
  const compactedValues = Array.from(
    new Set(
      values
        .map((value) => value?.replace(/\s+/g, " ").trim().slice(0, maxLength) ?? "")
        .filter(Boolean),
    ),
  );
  const unique = Array.from(
    new Set(
      compactedValues.flatMap(
        (value) => value.match(/[^。！？!?]+[。！？!?]?/gu)?.map((part) => part.trim()) ?? [],
      ),
    ),
  ).filter(Boolean);
  const meaningful = unique.filter(
    (value) => value.replace(/[\p{P}\p{S}\s_]+/gu, "").length >= 2,
  );
  return meaningful.length > 0 ? meaningful : compactedValues;
}

export const ILLUSTRATION_EFFECTS: readonly IllustrationEffectDefinition[] = [
  {
    id: "ian-xiaohei-illustrations",
    title: { en: "Xiaohei sketch", zh: "小黑手绘插画" },
    description: {
      en: "Hand-drawn character, arrows, and annotations",
      zh: "小黑人物、箭头与批注式表达",
    },
    repository: "helloianneo/ian-xiaohei-illustrations",
  },
  {
    id: "html-infographic",
    title: { en: "Information card", zh: "信息图插画" },
    description: {
      en: "Structured cards turn clip data into a visual summary",
      zh: "用结构化卡片总结片段信息",
    },
    repository: "openai/visualize",
  },
  {
    id: "html-concept-explainer",
    title: { en: "Concept explainer", zh: "概念解释插画" },
    description: { en: "A source-to-result visual explanation", zh: "从输入到结果的概念解释图" },
    repository: "ipollowork/faceless-explainer",
  },
  {
    id: "html-kinetic-typography",
    title: { en: "Kinetic type", zh: "动态排版插画" },
    description: {
      en: "Bold editorial typography frozen at its hero beat",
      zh: "定格在主视觉节拍的强排版",
    },
    repository: "heygen-com/hyperframes",
  },
  {
    id: "html-svg-path",
    title: { en: "Path story", zh: "SVG 路径插画" },
    description: {
      en: "A connected journey drawn from the selected clip",
      zh: "把选中片段绘制成路径旅程",
    },
    repository: "heygen-com/hyperframes",
  },
  {
    id: "html-3d-space",
    title: { en: "Spatial cards", zh: "3D 空间插画" },
    description: {
      en: "Layered cards with a restrained perspective look",
      zh: "克制透视与分层卡片空间",
    },
    repository: "heygen-com/hyperframes",
  },
] as const;

export const ILLUSTRATION_EFFECT_SAMPLE: IllustrationEffectData = {
  title: "把片段重点变成一眼看懂的插画",
  subtitle: "保留原有版式，只替换所选片段的内容数据。",
  eyebrow: "片段插画",
  detail: "选择片段 · 生成素材 · 插入当前帧",
  sourceLabel: "示例片段",
  sourceKind: "HTML",
  duration: 5,
};

function compactText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const compacted = value.replace(/\s+/g, " ").trim();
  if (!compacted) return fallback;
  return compacted.slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeIllustrationEffectData(
  value: Partial<IllustrationEffectData>,
): IllustrationEffectData {
  const duration = Number(value.duration);
  return {
    title: compactText(value.title, ILLUSTRATION_EFFECT_SAMPLE.title, 72),
    subtitle: compactText(value.subtitle, ILLUSTRATION_EFFECT_SAMPLE.subtitle, 140),
    eyebrow: compactText(value.eyebrow, ILLUSTRATION_EFFECT_SAMPLE.eyebrow, 30),
    detail: compactText(value.detail, ILLUSTRATION_EFFECT_SAMPLE.detail, 120),
    sourceLabel: compactText(value.sourceLabel, ILLUSTRATION_EFFECT_SAMPLE.sourceLabel, 48),
    sourceKind: compactText(value.sourceKind, ILLUSTRATION_EFFECT_SAMPLE.sourceKind, 18),
    duration: Number.isFinite(duration) ? Math.min(12, Math.max(1, duration)) : 5,
  };
}

function sharedStyles(accent: string, background: string, foreground: string): string {
  return `
    :root { color-scheme: light; --accent: ${accent}; --bg: ${background}; --fg: ${foreground}; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: var(--bg); color: var(--fg); font-family: Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
    .frame { position: relative; width: 1600px; height: 900px; overflow: hidden; isolation: isolate; }
    .eyebrow { font-size: 25px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .title { margin: 0; font-size: 76px; font-weight: 900; line-height: 1.08; letter-spacing: -.045em; }
    .subtitle { margin: 0; font-size: 31px; line-height: 1.55; }
    .meta { font-size: 22px; font-weight: 700; letter-spacing: .02em; }
  `;
}

function sketchScene(data: IllustrationEffectData): string {
  return `
    <main class="frame sketch">
      <div class="sun"></div><div class="scribble s1"></div><div class="scribble s2"></div>
      <section class="copy">
        <div class="eyebrow">${escapeHtml(data.eyebrow)}</div>
        <h1 class="title">${escapeHtml(data.title)}</h1>
        <p class="subtitle">${escapeHtml(data.subtitle)}</p>
        <div class="note">${escapeHtml(data.detail)}</div>
      </section>
      <svg class="doodle" viewBox="0 0 600 660" aria-hidden="true">
        <path d="M300 96c-40 0-72 32-72 72s32 72 72 72 72-32 72-72-32-72-72-72Z" fill="#171717"/>
        <circle cx="277" cy="165" r="7" fill="#fff"/><circle cx="324" cy="165" r="7" fill="#fff"/>
        <path d="M297 189c15 9 30 7 43-5" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
        <path d="M294 240c-75 19-114 91-105 177l13 125M307 241c76 27 105 95 89 181l-17 126" fill="none" stroke="#171717" stroke-width="30" stroke-linecap="round"/>
        <path d="M205 316 88 403M389 317l113-91M213 546l-79 79M372 547l82 75" fill="none" stroke="#171717" stroke-width="25" stroke-linecap="round"/>
        <path d="m476 181 48 38-58 17" fill="none" stroke="#ef4d37" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M434 207c-43-12-72 0-91 34" fill="none" stroke="#ef4d37" stroke-width="10" stroke-linecap="round"/>
      </svg>
      <div class="label label-a">${escapeHtml(data.sourceKind)}</div>
      <div class="label label-b">${escapeHtml(data.sourceLabel)}</div>
    </main>`;
}

function infographicScene(data: IllustrationEffectData): string {
  const duration = `${data.duration.toFixed(1)}s`;
  return `
    <main class="frame info">
      <header><div class="eyebrow">${escapeHtml(data.eyebrow)}</div><div class="source">${escapeHtml(data.sourceLabel)}</div></header>
      <h1 class="title">${escapeHtml(data.title)}</h1>
      <p class="subtitle">${escapeHtml(data.subtitle)}</p>
      <section class="cards">
        <article><b>01</b><span>内容</span><strong>${escapeHtml(data.detail)}</strong></article>
        <article><b>02</b><span>类型</span><strong>${escapeHtml(data.sourceKind)}</strong></article>
        <article><b>03</b><span>时长</span><strong>${duration}</strong></article>
      </section>
      <div class="rail"><i></i><i></i><i></i></div>
    </main>`;
}

function explainerScene(data: IllustrationEffectData): string {
  return `
    <main class="frame explain">
      <div class="eyebrow">${escapeHtml(data.eyebrow)}</div>
      <h1 class="title">${escapeHtml(data.title)}</h1>
      <section class="flow">
        <article><span>INPUT</span><b>${escapeHtml(data.sourceLabel)}</b><small>${escapeHtml(data.sourceKind)}</small></article>
        <svg viewBox="0 0 210 90" aria-hidden="true"><path d="M8 45h174m-35-29 36 29-36 29"/></svg>
        <article class="accent"><span>PROCESS</span><b>本地重组</b><small>${escapeHtml(data.detail)}</small></article>
        <svg viewBox="0 0 210 90" aria-hidden="true"><path d="M8 45h174m-35-29 36 29-36 29"/></svg>
        <article><span>OUTPUT</span><b>可编辑插画</b><small>${escapeHtml(data.subtitle)}</small></article>
      </section>
    </main>`;
}

function typographyScene(data: IllustrationEffectData): string {
  return `
    <main class="frame type">
      <div class="eyebrow">${escapeHtml(data.eyebrow)} · ${escapeHtml(data.sourceKind)}</div>
      <div class="ghost">${escapeHtml(data.title)}</div>
      <h1 class="title">${escapeHtml(data.title)}</h1>
      <div class="stripe"><span>${escapeHtml(data.detail)}</span><span>${escapeHtml(data.sourceLabel)}</span></div>
      <p class="subtitle">${escapeHtml(data.subtitle)}</p>
      <div class="index">${String(Math.round(data.duration * 10)).padStart(3, "0")}</div>
    </main>`;
}

function pathScene(data: IllustrationEffectData): string {
  return `
    <main class="frame path">
      <div class="eyebrow">${escapeHtml(data.eyebrow)}</div>
      <h1 class="title">${escapeHtml(data.title)}</h1>
      <svg class="route" viewBox="0 0 1380 470" aria-hidden="true">
        <path class="shadow" d="M40 365C190 95 370 60 520 240S850 430 1010 210s250-135 330-35"/>
        <path class="line" d="M40 365C190 95 370 60 520 240S850 430 1010 210s250-135 330-35"/>
        <g><circle cx="40" cy="365" r="28"/><circle cx="520" cy="240" r="28"/><circle cx="1010" cy="210" r="28"/><circle cx="1340" cy="175" r="28"/></g>
      </svg>
      <div class="waypoint p1">片段<br><b>${escapeHtml(data.sourceLabel)}</b></div>
      <div class="waypoint p2">提取<br><b>${escapeHtml(data.sourceKind)}</b></div>
      <div class="waypoint p3">重组<br><b>${escapeHtml(data.detail)}</b></div>
      <div class="waypoint p4">呈现<br><b>${escapeHtml(data.subtitle)}</b></div>
    </main>`;
}

function spaceScene(data: IllustrationEffectData): string {
  return `
    <main class="frame space">
      <div class="halo"></div>
      <section class="space-copy"><div class="eyebrow">${escapeHtml(data.eyebrow)}</div><h1 class="title">${escapeHtml(data.title)}</h1><p class="subtitle">${escapeHtml(data.subtitle)}</p></section>
      <section class="deck">
        <article class="card back"><span>SOURCE</span><b>${escapeHtml(data.sourceLabel)}</b></article>
        <article class="card mid"><span>FORMAT</span><b>${escapeHtml(data.sourceKind)}</b></article>
        <article class="card front"><span>FOCUS</span><b>${escapeHtml(data.detail)}</b><small>${data.duration.toFixed(1)} SEC</small></article>
      </section>
    </main>`;
}

function effectScene(id: IllustrationEffectId, data: IllustrationEffectData): string {
  if (id === "ian-xiaohei-illustrations") return sketchScene(data);
  if (id === "html-infographic") return infographicScene(data);
  if (id === "html-concept-explainer") return explainerScene(data);
  if (id === "html-kinetic-typography") return typographyScene(data);
  if (id === "html-svg-path") return pathScene(data);
  return spaceScene(data);
}

const EFFECT_STYLES = `
  .sketch { background:#fffdf7; } .sketch .copy{position:absolute;left:110px;top:105px;width:860px}.sketch .eyebrow{color:#ef4d37}.sketch .title{margin-top:24px;font-size:82px}.sketch .subtitle{margin-top:30px;width:720px}.sketch .note{display:inline-block;margin-top:35px;padding:15px 22px;background:#ffd84d;border:4px solid #171717;border-radius:50% 45% 48% 42%;font-size:24px;font-weight:800;transform:rotate(-1.5deg)}.doodle{position:absolute;right:55px;bottom:25px;width:570px;height:690px}.sun{position:absolute;right:145px;top:45px;width:170px;height:170px;border-radius:50%;background:#ffd84d}.scribble{position:absolute;border:7px solid #2d67ff;border-radius:50%}.s1{left:48px;bottom:60px;width:170px;height:48px;transform:rotate(-8deg)}.s2{right:360px;bottom:86px;width:95px;height:28px}.label{position:absolute;padding:9px 17px;border:4px solid #171717;background:#fff;font-size:20px;font-weight:900;transform:rotate(-4deg)}.label-a{right:85px;top:285px}.label-b{right:310px;bottom:60px;transform:rotate(3deg)}
  .info{padding:80px 100px;background:#111318;color:#f8f8f4}.info header{display:flex;justify-content:space-between;align-items:center}.info .eyebrow{color:#65dfca}.info .source{padding:12px 18px;border:1px solid #4b515b;border-radius:999px;font-size:20px}.info .title{margin-top:60px;width:1160px}.info .subtitle{margin-top:22px;color:#aeb5bf}.cards{display:grid;grid-template-columns:1.4fr .8fr .6fr;gap:20px;margin-top:70px}.cards article{min-height:235px;padding:28px;border:1px solid #363b44;border-radius:24px;background:#1b1e24}.cards b{color:#65dfca;font-size:24px}.cards span{display:block;margin-top:38px;color:#838b97;font-size:19px}.cards strong{display:block;margin-top:12px;font-size:26px;line-height:1.35}.rail{position:absolute;left:100px;right:100px;bottom:45px;display:flex;gap:12px}.rail i{height:7px;flex:1;border-radius:9px;background:#363b44}.rail i:first-child{flex:2;background:#65dfca}
  .explain{padding:75px 90px;background:#f5f2eb}.explain .eyebrow{color:#e45d38}.explain .title{margin-top:20px;font-size:66px}.flow{display:grid;grid-template-columns:1fr 160px 1fr 160px 1fr;align-items:center;margin-top:92px}.flow article{height:330px;padding:34px;border:3px solid #191919;border-radius:28px;background:#fff;box-shadow:12px 12px 0 #191919}.flow article.accent{background:#ffd95e}.flow article span{font-size:17px;font-weight:900;letter-spacing:.15em}.flow article b{display:block;margin-top:78px;font-size:36px}.flow article small{display:block;margin-top:20px;font-size:20px;line-height:1.45}.flow svg path{fill:none;stroke:#191919;stroke-width:8;stroke-linecap:round;stroke-linejoin:round}
  .type{padding:76px 90px;background:#f2ff3c;color:#101010}.type .eyebrow{position:relative;z-index:2}.type .ghost{position:absolute;left:73px;top:170px;width:1420px;color:transparent;-webkit-text-stroke:3px rgba(16,16,16,.16);font-size:112px;font-weight:950;line-height:.95;text-transform:uppercase;transform:translate(22px,-18px)}.type .title{position:relative;z-index:2;margin-top:90px;width:1310px;font-size:118px;line-height:.93;text-transform:uppercase}.stripe{position:absolute;left:0;right:0;bottom:165px;display:flex;justify-content:space-between;padding:19px 90px;background:#101010;color:#f2ff3c;font-size:25px;font-weight:900}.type .subtitle{position:absolute;left:90px;bottom:72px;width:1080px;font-size:27px}.index{position:absolute;right:72px;bottom:43px;font-size:92px;font-weight:950;opacity:.2}
  .path{padding:65px 100px;background-color:#0b1730;background-image:linear-gradient(rgba(94,124,170,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(94,124,170,.1) 1px,transparent 1px);background-size:50px 50px;color:#eef5ff}.path .eyebrow{color:#65dfca}.path .title{margin-top:16px;font-size:65px}.route{position:absolute;left:105px;right:105px;bottom:75px;width:1390px;height:480px}.route .shadow{fill:none;stroke:#09101e;stroke-width:34}.route .line{fill:none;stroke:#65dfca;stroke-width:13;stroke-linecap:round;stroke-dasharray:22 18}.route circle{fill:#ffca52;stroke:#0b1730;stroke-width:12}.waypoint{position:absolute;width:240px;color:#a9bad3;font-size:18px;line-height:1.4}.waypoint b{color:#fff;font-size:23px}.p1{left:82px;bottom:72px}.p2{left:530px;bottom:455px}.p3{left:1020px;bottom:390px}.p4{right:65px;bottom:355px}
  .space{background:#0f1020;color:#fff;perspective:1100px}.halo{position:absolute;right:70px;top:10px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,#6657ff66 0,#21d9bd22 42%,transparent 70%)}.space-copy{position:absolute;left:95px;top:120px;width:700px}.space .eyebrow{color:#7ee8d4}.space .title{margin-top:25px}.space .subtitle{margin-top:30px;color:#a8acc6}.deck{position:absolute;right:90px;top:125px;width:680px;height:650px;transform:rotateY(-16deg) rotateX(7deg);transform-style:preserve-3d}.card{position:absolute;width:520px;height:285px;padding:34px;border:1px solid #ffffff38;border-radius:28px;background:linear-gradient(145deg,#ffffff20,#ffffff0a);box-shadow:0 30px 70px #0008;backdrop-filter:blur(12px)}.card span{font-size:17px;letter-spacing:.16em;color:#7ee8d4}.card b{display:block;margin-top:82px;font-size:32px;line-height:1.25}.card small{display:block;margin-top:24px;color:#a8acc6;font-size:17px}.back{left:100px;top:12px;transform:translateZ(-160px) rotate(-5deg);opacity:.6}.mid{left:58px;top:150px;transform:translateZ(-70px) rotate(3deg);opacity:.78}.front{left:5px;top:310px;transform:translateZ(45px) rotate(-2deg);background:linear-gradient(145deg,#6758ff88,#1ed8ba33)}
`;

export function renderIllustrationEffectHtml(
  id: IllustrationEffectId,
  input: Partial<IllustrationEffectData>,
): string {
  const data = normalizeIllustrationEffectData(input);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1600, initial-scale=1" />
  <title>${escapeHtml(data.title)}</title>
  <style>${sharedStyles("#65dfca", "#ffffff", "#171717")}${EFFECT_STYLES}</style>
</head>
<body data-ipollowork-illustration="${id}" data-ipollowork-renderer="local-v1">
${effectScene(id, data)}
</body>
</html>`;
}

function slugify(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (ascii || "clip").slice(0, 28).replace(/-+$/g, "") || "clip";
}

export function createIllustrationAssetPath(
  id: IllustrationEffectId,
  data: Partial<IllustrationEffectData>,
  existingPaths: Iterable<string>,
): string {
  const normalized = normalizeIllustrationEffectData(data);
  const style = id.replace(/^html-/, "").replace(/-illustrations$/, "");
  const base = `${style}-${slugify(normalized.title)}`;
  const existing = new Set(
    Array.from(existingPaths, (path) => path.replace(/\\/g, "/").toLowerCase()),
  );
  let suffix = 1;
  let candidate = `assets/video-illustrations/${base}.html`;
  while (existing.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `assets/video-illustrations/${base}-${suffix}.html`;
  }
  return candidate;
}

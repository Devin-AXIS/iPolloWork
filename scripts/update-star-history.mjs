#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error(`Invalid argument near ${key ?? "end of command"}`);
  }
  args.set(key.slice(2), value);
}

const repository = args.get("repository");
const count = Number(args.get("count"));
const dataPath = args.get("data");
const outputDir = args.get("output-dir");
const updatedAt = args.get("updated-at") ?? new Date().toISOString();

if (!repository?.match(/^[^/]+\/[^/]+$/)) {
  throw new Error("--repository must use owner/name format");
}
if (!Number.isSafeInteger(count) || count < 0) {
  throw new Error("--count must be a non-negative integer");
}
if (!dataPath || !outputDir || Number.isNaN(Date.parse(updatedAt))) {
  throw new Error("--data, --output-dir, and a valid --updated-at are required");
}

const data = JSON.parse(await readFile(dataPath, "utf8"));
if (data.repository !== repository || !Array.isArray(data.points)) {
  throw new Error("Star history data does not match the requested repository");
}

const date = updatedAt.slice(0, 10);
const lastPoint = data.points.at(-1);
if (lastPoint && date < lastPoint.date) {
  throw new Error(`Refusing to insert ${date} before existing point ${lastPoint.date}`);
}
if (lastPoint?.date === date && lastPoint.count !== count) {
  lastPoint.count = count;
  data.updatedAt = updatedAt;
} else if (lastPoint?.date !== date) {
  data.points.push({ date, count });
  data.updatedAt = updatedAt;
}

await mkdir(outputDir, { recursive: true });
await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);
await Promise.all([
  writeFile(path.join(outputDir, "star-history-light.svg"), renderChart(data, "light")),
  writeFile(path.join(outputDir, "star-history-dark.svg"), renderChart(data, "dark")),
]);

function renderChart(history, themeName) {
  const theme =
    themeName === "dark"
      ? {
          background: "#0d1117",
          grid: "#30363d",
          muted: "#8b949e",
          text: "#f0f6fc",
          line: "#ff7b54",
          fill: "#ff7b54",
        }
      : {
          background: "#ffffff",
          grid: "#d8dee4",
          muted: "#57606a",
          text: "#24292f",
          line: "#f05a37",
          fill: "#f05a37",
        };
  const width = 900;
  const height = 500;
  const margin = { top: 88, right: 40, bottom: 64, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const parsed = history.points.map((point) => ({
    count: point.count,
    date: point.date,
    time: Date.parse(`${point.date}T00:00:00Z`),
  }));
  if (parsed.length === 0) {
    throw new Error("Star history needs at least one point");
  }

  const minTime = parsed[0].time;
  const maxTime = parsed.at(-1).time;
  const maxCount = Math.max(...parsed.map((point) => point.count), 1);
  const yMax = niceCeiling(maxCount);
  const timeSpan = Math.max(maxTime - minTime, 1);
  const sampled = samplePoints(parsed, 720);
  const x = (time) => margin.left + ((time - minTime) / timeSpan) * plotWidth;
  const y = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;
  const linePath = sampled
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.time).toFixed(1)} ${y(point.count).toFixed(1)}`)
    .join(" ");
  const fillPath = `${linePath} L${x(sampled.at(-1).time).toFixed(1)} ${margin.top + plotHeight} L${x(sampled[0].time).toFixed(1)} ${margin.top + plotHeight} Z`;
  const identifier = `star-history-${themeName}`;
  const latest = parsed.at(-1);

  const yTicks = Array.from({ length: 6 }, (_, index) => (yMax * index) / 5);
  const xTicks = Array.from({ length: 5 }, (_, index) => minTime + (timeSpan * index) / 4);
  const grid = yTicks
    .map(
      (value) =>
        `<line x1="${margin.left}" y1="${y(value).toFixed(1)}" x2="${width - margin.right}" y2="${y(value).toFixed(1)}" stroke="${theme.grid}" stroke-width="1" />` +
        `<text x="${margin.left - 14}" y="${(y(value) + 5).toFixed(1)}" fill="${theme.muted}" font-size="13" text-anchor="end">${formatCount(value)}</text>`,
    )
    .join("");
  const dates = xTicks
    .map(
      (time, index) =>
        `<text x="${x(time).toFixed(1)}" y="${height - 26}" fill="${theme.muted}" font-size="13" text-anchor="${index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}">${formatDate(time)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${identifier}-title ${identifier}-description">
  <title id="${identifier}-title">${escapeXml(history.repository)} star history</title>
  <desc id="${identifier}-description">${formatCount(latest.count)} stars as of ${escapeXml(latest.date)}</desc>
  <defs>
    <linearGradient id="${identifier}-fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${theme.fill}" stop-opacity="0.26" />
      <stop offset="100%" stop-color="${theme.fill}" stop-opacity="0.02" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="16" fill="${theme.background}" />
  <text x="${margin.left}" y="38" fill="${theme.text}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="24" font-weight="700">Star History</text>
  <text x="${margin.left}" y="65" fill="${theme.muted}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="14">${escapeXml(history.repository)} · ${formatCount(latest.count)} stars · Updated ${escapeXml(latest.date)}</text>
  <g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    ${grid}
    ${dates}
    <path d="${fillPath}" fill="url(#${identifier}-fill)" />
    <path d="${linePath}" fill="none" stroke="${theme.line}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${x(latest.time).toFixed(1)}" cy="${y(latest.count).toFixed(1)}" r="5" fill="${theme.background}" stroke="${theme.line}" stroke-width="3" />
    <text x="${width - margin.right}" y="65" fill="${theme.muted}" font-size="13" text-anchor="end">Interactive chart: star-history.com</text>
  </g>
</svg>
`;
}

function samplePoints(points, limit) {
  if (points.length <= limit) return points;
  const result = [];
  for (let index = 0; index < limit; index += 1) {
    result.push(points[Math.round((index * (points.length - 1)) / (limit - 1))]);
  }
  return result;
}

function niceCeiling(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function formatCount(value) {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimDecimal(value) {
  return value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatDate(time) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(time));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

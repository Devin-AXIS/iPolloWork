import { Script } from "node:vm";
import { stat } from "node:fs/promises";
import { resolveWithinRoot } from "./paths.js";

type VideoHtmlIssue = { code: string; message: string };
const registryInitialization = "window.__timelines = window.__timelines || {};";

// Inspect only executable classic scripts. Never execute model-generated code
// in the server; module/import graphs remain the browser's responsibility.
function classicScripts(html: string) {
  const active = html.replace(/<!--[\s\S]*?-->|<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, (inert) => " ".repeat(inert.length));
  return [...active.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter((match) => {
    const type = match[1]?.match(/\btype\s*=\s*["']([^"']*)["']/i)?.[1]?.toLowerCase();
    return !type || /^(?:text|application)\/(?:java|ecma)script$/.test(type);
  });
}

export function validateVideoHtmlScripts(html: string): VideoHtmlIssue[] {
  const issues: VideoHtmlIssue[] = [];
  let gsapAvailable = false;
  let registryAvailable = false;
  for (const script of classicScripts(html)) {
    const attributes = script[1] ?? "";
    const source = script[2] ?? "";
    const src = attributes.match(/\bsrc\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
    if (src) {
      if (/(?:^|\/)gsap(?:\.min)?\.js(?:[?#]|$)/i.test(src[1] ?? src[2] ?? "") && !/\b(?:async|defer)\b/i.test(attributes.replace(/(["'])[\s\S]*?\1/g, ""))) gsapAvailable = true;
      continue;
    }
    // Bun defers compilation until cached data is requested; neither operation executes it.
    try { new Script(source).createCachedData(); }
    catch (error) {
      issues.push({ code: "invalid_video_script", message: `Video inline JavaScript is invalid: ${error instanceof Error ? error.message : "syntax error"}. Fix it before delivery.` });
      continue;
    }
    // An inlined GSAP distribution carries this banner, not just a call to gsap.
    if (/GSAP\s+\d+\.\d+|GreenSock Animation Platform/.test(source) && /(?:function|=>)/.test(source)) gsapAvailable = true;
    if (/\bgsap\s*\.\s*(?:timeline|to|from|fromTo|set)\s*\(/.test(source) && !gsapAvailable) {
      issues.push({ code: "missing_video_gsap", message: "GSAP is used before a synchronous GSAP script is loaded. Include a local gsap.min.js (and package it) or a working GSAP script URL before the animation script; do not rely on Video Studio to supply GSAP or use async/defer before inline animation." });
    }
    const initialization = source.search(/window\.__timelines\s*(?:\|\|=|=\s*(?:window\.__timelines\s*\|\|\s*)?\{)/);
    const registration = source.search(/window\.__timelines\s*(?:\[[^\]]+\]|\.[\w$]+)\s*=/);
    if (registration >= 0 && !registryAvailable && (initialization < 0 || initialization > registration)) {
      issues.push({ code: "missing_video_timeline_registry", message: `Initialize the timeline registry before registering animations: ${registryInitialization}` });
    }
    if (initialization >= 0) registryAvailable = true;
  }
  return issues.filter((issue, index) => issues.findIndex((other) => other.code === issue.code) === index);
}

export function repairVideoTimelineRegistry(html: string): string {
  if (!validateVideoHtmlScripts(html).some((issue) => issue.code === "missing_video_timeline_registry")) return html;
  const script = classicScripts(html).find((entry) => /window\.__timelines\s*(?:\[[^\]]+\]|\.[\w$]+)\s*=/.test(entry[2] ?? ""));
  if (!script) return html;
  const start = script.index;
  return html.slice(0, start) + script[0].replace(/>/, `>\n${registryInitialization}\n`) + html.slice(start + script[0].length);
}

export async function validateVideoScriptAssets(html: string, directory: string): Promise<VideoHtmlIssue[]> {
  const issues: VideoHtmlIssue[] = [];
  const sources = new Set(classicScripts(html).flatMap((script) => {
    const match = script[1]?.match(/\bsrc\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
    return match ? [match[1] ?? match[2] ?? ""] : [];
  }));
  for (const source of sources) {
    if (/^(?:https?:)?\/\//i.test(source)) continue;
    try {
      if (!source || /^[a-z][\w+.-]*:|^[\\/]/i.test(source)) throw new Error("Non-portable script path");
      const path = await resolveWithinRoot(directory, decodeURIComponent(source.split(/[?#]/)[0] ?? ""));
      if (!(await stat(path)).isFile()) throw new Error("Not a file");
    } catch {
      issues.push({ code: "missing_video_script_asset", message: `Script ${source} must be a real file inside the video package. Copy the dependency into the project and fix its relative src before delivery.` });
    }
  }
  return issues;
}

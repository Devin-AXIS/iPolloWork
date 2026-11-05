import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/app/index.css";
import { templateManifestV1Schema, type TemplateCatalogItem } from "@ipollowork/types/templates";
import { type EnterpriseConnection, type EnterpriseResource } from "../src/app/lib/enterprise-connections";
import { writeDenSettings } from "../src/app/lib/den";
import { TemplateMarketDialog, type TemplateCatalogSource } from "../src/react-app/domains/session/templates/template-market-dialog";

const manifest = templateManifestV1Schema.parse({ schemaVersion: 1, id: "test.template-card", version: "1.0.0", kind: "design", category: "site", subcategory: "landing", style: "minimal", title: "品牌网站模板", description: "用于验证三个来源统一卡片的模板。", cover: "cover.svg", entry: "entry.html", source: { name: "Test", license: "Private" }, designSystem: { tokenVersion: 1, editableGroups: ["theme"] }, applyChecklist: ["Update content"], minimumAppVersion: "0.1.0" });
const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#eeeae2"/><circle cx="1290" cy="380" r="250" fill="#c1cec3"/><text x="100" y="300" font-family="Georgia" font-size="100" fill="#24352e">A place for</text><text x="100" y="425" font-family="Georgia" font-size="100" fill="#24352e">your next idea.</text></svg>';
const item: TemplateCatalogItem = { manifest, sourceType: "bundled", installed: true, installedVersion: "1.0.0", updateAvailable: false, verified: true };
const resource: EnterpriseResource = { id: "remote-card", type: "template", slug: manifest.id, manifestId: manifest.id, name: manifest.title, description: manifest.description, category: "site", enterpriseCategory: "品牌", iconPath: null, featured: false, updatedAt: "2026-10-22", latestVersion: { version: "1.0.0", digest: "a".repeat(64), downloadPath: "/api/v1/resources/remote-card/versions/1.0.0/download" } };
const connection: EnterpriseConnection = { id: "ent_cards", name: "验证企业", shortName: "企业", origin: "https://enterprise-card-proof.invalid", logoUrl: null, accent: "blue", authMode: "ipollo_oidc", membership: { id: "proof-member", role: "member" }, session: { token: "synthetic-member-token", expiresAt: "2099-01-01" } };
let refreshes = 0; let covers = 0; let previews = 0; let failures = 1; let requests: string[] = [];
writeDenSettings({ baseUrl: "https://cloud-card-proof.invalid", authToken: "synthetic-cloud-token" });
const baseFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!url.hostname.endsWith("-card-proof.invalid")) return baseFetch(input, init);
  requests.push(url.pathname);
  if (url.pathname.endsWith("/failed-card") && failures-- > 0) return Response.json({ error: "temporary_unavailable" }, { status: 503 });
  previews++;
  return Response.json({ manifest, coverDataUrl: `data:image/svg+xml;base64,${btoa(cover)}` });
};

function Proof() {
  const [source, setSource] = useState<TemplateCatalogSource>("builtin");
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ticks, setTicks] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTicks((value) => value + 1), 200); return () => clearInterval(timer); }, []);
  return <main data-testid="template-market-proof" data-refreshes={refreshes} data-covers={covers} data-previews={previews} data-ticks={ticks} data-downloads={requests.filter((path) => path.includes("/download")).length}>
    <button onClick={() => setOpen(true)}>打开模板</button>
    <TemplateMarketDialog open={open} onOpenChange={setOpen} templates={source === "builtin" ? [item] : installed ? [{ ...item, sourceType: "local" }] : []} remoteResources={source === "builtin" ? [] : [resource, { ...resource, id: "failed-card", name: "封面重试模板" }]} loading={loading} error={null} busyId={null}
      getCover={async () => { covers++; return { data: new TextEncoder().encode(cover).buffer, contentType: "image/svg+xml" }; }}
      cloudAvailable enterpriseAvailable enterpriseConnection={{ ...connection }} source={source} onSelectSource={setSource}
      onRefresh={() => { refreshes++; setLoading(true); window.setTimeout(() => setLoading(false), 100); }} onUse={() => {}} onCustom={() => {}} onInstall={() => {}} onImport={async () => true} onInstallRemote={() => setInstalled(true)} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Proof />);

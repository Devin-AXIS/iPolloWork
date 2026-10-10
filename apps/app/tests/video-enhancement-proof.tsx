/** @jsxImportSource react */
import React from "react";
import { createRoot } from "react-dom/client";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { VideoEnhancementPanel } from "../src/react-app/domains/session/video/video-enhancement-panel";
import { setLocale } from "../src/i18n";
import "../src/app/index.css";
setLocale("zh");
const origin = "http://127.0.0.1:5288";
const client = createiPolloWorkServerClient({ baseUrl: "http://127.0.0.1:5287", token: "local-enhancement-proof" });
function App() {
  const [revision, setRevision] = React.useState(0);
  return <main className="flex h-screen flex-col bg-background text-foreground"><header className="border-b p-4 text-sm font-medium">视频工作台 · 本地智能增强验证</header>
    <VideoEnhancementPanel client={client} workspaceId="proof" sessionId="proof" previewAssetUrl={path => `${origin}/files/${path}`} onApplied={() => setRevision(value => value + 1)} />
    <iframe title="增强结果" className="min-h-0 flex-1 border-0" src={`${origin}/files/video/proof/index.html?revision=${revision}`} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
Object.assign(window, { __ipolloworkControl: { fixture: true } });

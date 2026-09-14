// Production dialog and parser; the final model call is replaced with a payload receipt.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TemplateApplyDialog } from "../../apps/app/src/react-app/domains/session/chat/session-page";
import { buildTemplateReferenceSubmitPayload } from "../../apps/app/src/react-app/domains/session/references/template-reference-submit";
import { Button } from "../../apps/app/src/components/ui/button";
import { TooltipProvider } from "../../apps/app/src/components/ui/tooltip";
import { setLocale } from "../../apps/app/src/i18n";
import "../../apps/app/src/app/index.css";

setLocale("zh");
function Fixture() {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  return <TooltipProvider><main className="min-h-screen bg-background p-10 text-foreground">
    <h1 className="mb-4 text-lg font-semibold">产品介绍视频</h1>
    <Button onClick={() => { setReceipt(null); setOpen(true); }}>使用模板</Button>
    {open ? <TemplateApplyDialog open mode="current-conversation" template={{ title: "产品介绍视频", category: "video", surface: "video" }} onClose={() => setOpen(false)} onSubmit={async (brief, references) => {
      const payload = await buildTemplateReferenceSubmitPayload(references);
      const parsed = payload.attachments.find((attachment) => attachment.delivery === "workspace");
      const result = { brief, context: parsed ? JSON.parse(await parsed.file.text()) : null, attachmentNames: payload.attachments.map((attachment) => attachment.name) };
      window.__referenceReceipt = result;
      setReceipt(result);
      setOpen(false);
    }} /> : null}
    {receipt ? <section className="mt-6" aria-label="提交结果"><h2>需求已提交</h2><p>{receipt.brief.title}</p><p>{receipt.attachmentNames.join(", ")}</p></section> : null}
  </main></TooltipProvider>;
}
createRoot(document.getElementById("root")).render(<Fixture />);

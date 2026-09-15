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
const category = new URLSearchParams(location.search).get("category") ?? "video";
function Fixture() {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  return <TooltipProvider><main className="min-h-screen bg-background p-10 text-foreground">
    <h1 className="mb-4 text-lg font-semibold">产品介绍视频</h1>
    <Button onClick={() => { setReceipt(null); setOpen(true); }}>使用模板</Button>
    {open ? <TemplateApplyDialog open mode="current-conversation" template={{ title: "产品介绍视频", category, surface: category === "video" ? "video" : "design" }} onClose={() => setOpen(false)} onSubmit={async (brief, references) => {
      const payload = await buildTemplateReferenceSubmitPayload(references, { brief });
      const parsed = payload.attachments.find((attachment) => attachment.delivery === "workspace");
      let context = parsed ? JSON.parse(await parsed.file.text()) : null;
      if (context?.storage === "json-string-parts") {
        const fragments = await Promise.all(context.parts.map(async (part) => JSON.parse(await payload.attachments.find((item) => item.name === part.attachmentName).file.text())));
        context = JSON.parse(fragments.join(""));
      }
      const creativeAttachment = payload.attachments.find((item) => item.name === "creative-context.json");
      const creativeContext = creativeAttachment ? JSON.parse(await creativeAttachment.file.text()) : null;
      const result = { brief, context, creativeContext, attachmentNames: payload.attachments.map((attachment) => attachment.name) };
      window.__referenceReceipt = result;
      setReceipt(result);
      setOpen(false);
    }} /> : null}
    {receipt ? <section className="mt-6 space-y-3" aria-label="提交结果"><h2>需求已提交</h2><p>{receipt.brief.title}</p><p aria-label="提交的风格">{receipt.brief.style}</p><p>{receipt.attachmentNames.join(", ")}</p>
      <ul>{receipt.context?.files.map((file) => <li key={file.id}>{file.source.name}：{file.text.length} 字符，{file.assets.length} 项附件来源；视觉内容：{file.coverage?.visuals ?? "none"}</li>)}</ul>
      <details><summary>查看测试提交数据</summary><pre className="whitespace-pre-wrap break-all text-xs" data-testid="reference-receipt">{JSON.stringify(receipt.context, null, 2)}</pre></details>
    </section> : null}
  </main></TooltipProvider>;
}
createRoot(document.getElementById("root")).render(<Fixture />);

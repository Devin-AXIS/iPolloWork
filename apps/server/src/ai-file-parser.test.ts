import { describe, expect, test } from "bun:test";

import { parseOpenAiFileAnalysisPayload, type AiFileAnalysis } from "./ai-file-parser.js";

describe("AI file parser", () => {
  test("extracts the first JSON object from model text", () => {
    const analysis = parseOpenAiFileAnalysisPayload({
      output_text: [
        "Here is the analysis:",
        JSON.stringify({
          summary: "Launch brief for enterprise designers.",
          userIntent: "Create a landing page.",
          targetAudience: "Enterprise design teams",
          keyFacts: ["Launch is in Q4"],
          designRequirements: ["Keep layout concise"],
          contentOutline: ["Hero", "Proof"],
          brandHints: ["Clean typography"],
          dataFindings: ["No table data"],
          missingInfo: ["Budget"],
          confidence: "high",
        }),
      ].join("\n"),
    });

    expect(analysis).toEqual({
      summary: "Launch brief for enterprise designers.",
      userIntent: "Create a landing page.",
      targetAudience: "Enterprise design teams",
      keyFacts: ["Launch is in Q4"],
      designRequirements: ["Keep layout concise"],
      contentOutline: ["Hero", "Proof"],
      brandHints: ["Clean typography"],
      dataFindings: ["No table data"],
      missingInfo: ["Budget"],
      confidence: "high",
    } satisfies AiFileAnalysis);
  });

  test("bounds malformed fields to a safe analysis shape", () => {
    const analysis = parseOpenAiFileAnalysisPayload({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            summary: 42,
            keyFacts: ["Useful", 100, "Another"],
            confidence: "certain",
          }),
        }],
      }],
    });

    expect(analysis).toMatchObject({
      summary: "",
      keyFacts: ["Useful", "Another"],
      confidence: "medium",
    });
  });
});

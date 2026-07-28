import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("hyperframes-effect-params");

const EFFECT_TITLE = "Liquid Background";
const PROMPT = "Create a 12-second launch video using the configured Liquid Background effect.";
const LABELS = {
  backgroundColor: "Background color",
  waveIntensity: "Wave intensity",
  animationSpeed: "Animation speed",
  duration: "Duration",
  ease: "Entrance easing",
};

let configuredCardLabel = "";

function buttonClickExpression(labels, parentText) {
  return `(() => {
    const labels = ${JSON.stringify(labels)};
    const button = [...document.querySelectorAll("button")].find((candidate) => {
      const labelMatches = labels.includes(candidate.innerText.trim());
      const parentMatches = ${JSON.stringify(parentText)}
        ? candidate.parentElement?.innerText.includes(${JSON.stringify(parentText)})
        : true;
      return labelMatches && parentMatches;
    });
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

async function clickLocalizedButton(ctx, labels, parentText = "") {
  const clicked = await ctx.eval(buttonClickExpression(labels, parentText));
  ctx.assert(clicked === true, `Could not find button: ${labels.join(" / ")}`);
}

async function setInputValue(ctx, label, value) {
  const updated = await ctx.eval(`(() => {
    const input = document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(label)}]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  ctx.assert(updated === true, `Could not update ${label}.`);
}

async function setSelectValue(ctx, label, value) {
  const updated = await ctx.eval(`(() => {
    const select = document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(label)}]');
    if (!(select instanceof HTMLSelectElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  ctx.assert(updated === true, `Could not update ${label}.`);
}

async function openEffectParameters(ctx) {
  const opened = await ctx.eval(`(() => {
    const selectButton = [...document.querySelectorAll("button")]
      .find((button) => button.innerText.includes(${JSON.stringify(EFFECT_TITLE)}));
    const card = selectButton?.parentElement;
    const configureButton = [...(card?.querySelectorAll("button") ?? [])]
      .find((button) => button !== selectButton);
    if (!configureButton) return false;
    configureButton.click();
    return true;
  })()`);
  ctx.assert(opened === true, `Could not open parameters for ${EFFECT_TITLE}.`);
  await ctx.waitFor(
    `Boolean(document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.backgroundColor)}]'))`,
    { timeoutMs: 15_000, label: "Liquid Background parameter dialog" },
  );
}

async function closeEffectParameters(ctx) {
  await clickLocalizedButton(ctx, ["关闭", "Close"], "");
  await ctx.waitFor("!document.querySelector('[role=\"dialog\"]')", {
    timeoutMs: 15_000,
    label: "parameter dialog closed",
  });
}

export default {
  id: "hyperframes-effect-params",
  title: "GSAP effects expose safe reusable parameters from catalog to Agent",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl) && Boolean(window.__ipollowork)", {
      timeoutMs: 60_000,
      label: "iPolloWork control and inspector APIs",
    });
    return null;
  },
  steps: [
    {
      name: "Video catalog identifies configurable effects",
      run: async (ctx) => {
        await ctx.prove("The video catalog visibly identifies a GSAP effect with adjustable parameters", {
          voiceover: vo[0],
          action: async () => {
            await ctx.ensureLightMode();
            if (await ctx.eval("Boolean(document.querySelector('[role=\"dialog\"]'))")) {
              await ctx.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
              await ctx.waitFor("!document.querySelector('[role=\"dialog\"]')", {
                timeoutMs: 10_000,
                label: "stale dialog closed",
              });
            }
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`,
              { timeoutMs: 60_000, label: "create task action" },
            );
            const previousRoute = await ctx.eval("window.__ipolloworkControl.snapshot().route");
            await ctx.control("session.create_task");
            await ctx.waitFor(
              `window.__ipolloworkControl.snapshot().route !== ${JSON.stringify(previousRoute)}
                && window.__ipolloworkControl.snapshot().route.includes("/session/")
                && [...document.querySelectorAll("button")].some((button) =>
                  ["视频制作", "Video"].includes(button.innerText.trim())
                )`,
              { timeoutMs: 60_000, label: "new task route" },
            );
            await clickLocalizedButton(ctx, ["视频制作", "Video"]);
            await ctx.waitForText(EFFECT_TITLE, { timeoutMs: 30_000 });
            await clickLocalizedButton(ctx, ["视觉特效", "Visual effects"]);
            await ctx.eval(`(() => {
              const card = [...document.querySelectorAll("button")]
                .find((button) => button.innerText.includes(${JSON.stringify(EFFECT_TITLE)}));
              card?.scrollIntoView({ block: "center", inline: "center" });
              return Boolean(card);
            })()`);
          },
          assert: async () => {
            const catalog = await ctx.eval(`(() => {
              const selectButton = [...document.querySelectorAll("button")]
                .find((button) => button.innerText.includes(${JSON.stringify(EFFECT_TITLE)}));
              const card = selectButton?.parentElement;
              return {
                title: selectButton?.innerText ?? "",
                cardText: card?.innerText ?? "",
                hasConfigureButton: [...(card?.querySelectorAll("button") ?? [])]
                  .some((button) => ["调整参数", "Adjust parameters"].includes(button.innerText.trim())),
              };
            })()`);
            ctx.assert(catalog.title.includes(EFFECT_TITLE), "Liquid Background was not rendered in the catalog.");
            ctx.assert(catalog.cardText.includes("GSAP"), "The catalog card did not expose the GSAP engine badge.");
            ctx.assert(
              catalog.cardText.includes("视觉特效") || catalog.cardText.includes("Visual effects"),
              "The catalog card did not expose its category.",
            );
            ctx.assert(catalog.hasConfigureButton, "The catalog card did not expose parameter adjustment.");
          },
          screenshot: {
            name: "catalog-gsap-parameters",
            requireText: ["GSAP", EFFECT_TITLE],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Schema generates the parameter controls",
      run: async (ctx) => {
        await ctx.prove("Selecting the GSAP effect opens controls generated from its variable contract", {
          voiceover: vo[1],
          action: async () => {
            const selected = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll("button")]
                .find((candidate) => candidate.innerText.includes(${JSON.stringify(EFFECT_TITLE)}));
              if (!button) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(selected === true, "Could not select Liquid Background.");
            await openEffectParameters(ctx);
          },
          assert: async () => {
            const controls = await ctx.eval(`(() => ({
              dialog: document.querySelector('[role="dialog"]')?.innerText ?? "",
              inputs: [...document.querySelectorAll('[role="dialog"] [aria-label]')]
                .map((input) => input.getAttribute("aria-label")),
            }))()`);
            for (const label of Object.values(LABELS)) {
              ctx.assert(controls.inputs.includes(label), `Missing generated control: ${label}`);
            }
            ctx.assert(controls.dialog.includes("Text color"), "Missing generated text color control.");
            ctx.assert(controls.dialog.includes("GSAP 3.14.2"), "The preview did not expose the resolved engine version.");
          },
          screenshot: {
            name: "schema-generated-controls",
            requireText: [
              EFFECT_TITLE,
              "Background color",
              "Wave intensity",
              "Animation speed",
              "Duration",
              "Entrance easing",
            ],
          },
        });
      },
    },
    {
      name: "Live values update inside declared bounds",
      run: async (ctx) => {
        await ctx.prove("Live color and intensity values update the preview while retaining manifest bounds", {
          voiceover: vo[2],
          action: async () => {
            await setInputValue(ctx, LABELS.backgroundColor, "#123456");
            await setInputValue(ctx, LABELS.waveIntensity, "2.5");
            await ctx.waitFor(
              `document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.waveIntensity)}]')?.value === "2.5"`,
              { timeoutMs: 10_000, label: "live wave intensity" },
            );
          },
          assert: async () => {
            const liveState = await ctx.eval(`(() => {
              const background = document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.backgroundColor)}]');
              const wave = document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.waveIntensity)}]');
              const preview = document.querySelector('[role="dialog"] video')?.parentElement;
              return {
                background: background?.value,
                wave: wave?.value,
                min: wave?.min,
                max: wave?.max,
                step: wave?.step,
                previewBackground: preview?.style.backgroundColor,
                status: document.querySelector('[role="dialog"]')?.innerText ?? "",
              };
            })()`);
            ctx.assert(liveState.background === "#123456", "The background color override was not retained.");
            ctx.assert(liveState.previewBackground === "rgb(18, 52, 86)", "The live preview did not adopt the background color.");
            ctx.assert(liveState.wave === "2.5", "The live wave intensity did not update.");
            ctx.assert(
              liveState.min === "0" && liveState.max === "3" && liveState.step === "0.1",
              "The wave intensity control lost its declared bounds.",
            );
            ctx.assert(
              liveState.status.includes("已实时应用") || liveState.status.includes("Applied without rebuilding"),
              "The UI did not confirm a live update.",
            );
          },
          screenshot: {
            name: "live-bounded-values",
            requireText: ["#123456", "2.5", "LIVE"],
          },
        });
      },
    },
    {
      name: "Rebuild values preserve preview time",
      run: async (ctx) => {
        await ctx.prove("Rebuild-only duration and easing changes reconstruct the timeline at the current preview time", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`(() => {
              const video = document.querySelector('[role="dialog"] video');
              if (video instanceof HTMLVideoElement) video.currentTime = 3.2;
              return true;
            })()`);
            await setInputValue(ctx, LABELS.duration, "18");
            await ctx.waitFor(
              `document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.duration)}]')?.value === "18"`,
              { timeoutMs: 10_000, label: "rebuilt duration" },
            );
            await ctx.eval(`(() => {
              const video = document.querySelector('[role="dialog"] video');
              if (video instanceof HTMLVideoElement) video.currentTime = 3.2;
              return true;
            })()`);
            await setSelectValue(ctx, LABELS.ease, "back.out");
            await ctx.waitFor(
              `document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.ease)}]')?.value === "back.out"`,
              { timeoutMs: 10_000, label: "rebuilt easing" },
            );
          },
          assert: async () => {
            const rebuildState = await ctx.eval(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return {
                duration: dialog?.querySelector('[aria-label=${JSON.stringify(LABELS.duration)}]')?.value,
                ease: dialog?.querySelector('[aria-label=${JSON.stringify(LABELS.ease)}]')?.value,
                text: dialog?.innerText ?? "",
              };
            })()`);
            ctx.assert(rebuildState.duration === "18", "The rebuilt timeline did not retain the duration.");
            ctx.assert(rebuildState.ease === "back.out", "The rebuilt timeline did not retain the easing value.");
            ctx.assert(
              rebuildState.text.includes("保持在 3.2 秒") || rebuildState.text.includes("Preserved at 3.2s"),
              "The rebuilt preview did not preserve the 3.2 second position.",
            );
            ctx.assert(
              rebuildState.text.includes("已在当前播放位置重建时间轴")
                || rebuildState.text.includes("Timeline rebuilt at the current preview position"),
              "The UI did not confirm a timeline rebuild.",
            );
          },
          screenshot: {
            name: "timeline-rebuild-preserves-time",
            requireText: ["18s", "Elastic", "REBUILD"],
          },
        });
      },
    },
    {
      name: "Instance configuration survives close and reopen",
      run: async (ctx) => {
        await ctx.prove("The selected effect keeps its configured state and restores instance values when reopened", {
          voiceover: vo[4],
          action: async () => {
            await closeEffectParameters(ctx);
            configuredCardLabel = await ctx.eval(`(() => {
              const selectButton = [...document.querySelectorAll("button")]
                .find((button) => button.innerText.includes(${JSON.stringify(EFFECT_TITLE)}));
              const card = selectButton?.parentElement;
              return [...(card?.querySelectorAll("button") ?? [])]
                .map((button) => button.innerText.trim())
                .find((label) => /4/.test(label)) ?? "";
            })()`);
            await openEffectParameters(ctx);
          },
          assert: async () => {
            ctx.assert(
              configuredCardLabel.includes("4"),
              `The closed card did not show four configured values: ${configuredCardLabel}`,
            );
            const restored = await ctx.eval(`(() => ({
              background: document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.backgroundColor)}]')?.value,
              wave: document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.waveIntensity)}]')?.value,
              duration: document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.duration)}]')?.value,
              ease: document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(LABELS.ease)}]')?.value,
            }))()`);
            ctx.assert(restored.background === "#123456", "The color instance value was not restored.");
            ctx.assert(restored.wave === "2.5", "The wave instance value was not restored.");
            ctx.assert(restored.duration === "18", "The duration instance value was not restored.");
            ctx.assert(restored.ease === "back.out", "The easing instance value was not restored.");
          },
          screenshot: {
            name: "instance-values-restored",
            requireText: ["#123456", "2.5", "18s", "Elastic"],
          },
        });
      },
    },
    {
      name: "Structured selection reaches the video Agent",
      run: async (ctx) => {
        await ctx.prove("Sending the video request carries effect identity, version, resolved variables, and seekability", {
          voiceover: vo[5],
          action: async () => {
            await closeEffectParameters(ctx);
            await ctx.eval("window.__ipollowork.clearEvents()");
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "composer.set_text" && !action.disabled)`,
              { timeoutMs: 30_000, label: "composer text action" },
            );
            await ctx.control("composer.set_text", { text: PROMPT });
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "composer.send" && !action.disabled)`,
              { timeoutMs: 30_000, label: "composer send action" },
            );
            await ctx.control("composer.send");
            await ctx.waitFor(
              `window.__ipollowork.events(200).some((event) => event.name === "composer.hyperframes_sent")`,
              { timeoutMs: 60_000, label: "accepted HyperFrames Agent payload" },
            );
            await ctx.waitForText(PROMPT, { timeoutMs: 30_000 });
          },
          assert: async () => {
            const event = await ctx.eval(`window.__ipollowork.events(200)
              .filter((candidate) => candidate.name === "composer.hyperframes_sent")
              .at(-1)`);
            const selection = event?.data?.selections?.[0];
            ctx.assert(selection?.registry === "vfx-liquid-background", "The Agent payload lost the effect registry ID.");
            ctx.assert(selection?.version === "1.0.0", "The Agent payload lost the effect version.");
            ctx.assert(selection?.engine?.name === "gsap", "The Agent payload lost the GSAP engine.");
            ctx.assert(selection?.engine?.version === "3.14.2", "The Agent payload lost the GSAP version.");
            ctx.assert(selection?.engine?.seekable === true, "The effect was not declared deterministically seekable.");
            ctx.assert(selection?.variables?.backgroundColor === "#123456", "The Agent payload lost the color override.");
            ctx.assert(selection?.variables?.waveIntensity === 2.5, "The Agent payload lost the wave override.");
            ctx.assert(selection?.variables?.duration === 18, "The Agent payload lost the duration override.");
            ctx.assert(selection?.variables?.ease === "back.out", "The Agent payload lost the easing override.");
            ctx.log(`Accepted HyperFrames selection: ${JSON.stringify(selection)}`);
          },
          screenshot: {
            name: "structured-selection-sent",
            requireText: [PROMPT],
          },
        });
      },
    },
  ],
};

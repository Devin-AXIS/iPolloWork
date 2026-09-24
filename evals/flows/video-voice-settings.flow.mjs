import { execFileSync } from 'node:child_process';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
const vo = await loadVoiceoverParagraphs('video-voice-settings');
const origin = process.env.IPOLLOWORK_VOICE_PROOF_ORIGIN || 'http://127.0.0.1:5186';
async function open(ctx, query) {
  await ctx.client.send('Emulation.setDeviceMetricsOverride', {width: 960, height: 900, deviceScaleFactor: 1, mobile: false});
  await ctx.client.send('Page.navigate', {url: `${origin}/tests/video-avatar-proof.html?${query}`});
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="video-voice-panel"] [role="switch"]'))`);
  await ctx.waitFor(`!document.body.innerText.includes('正在读取百炼配置')`);
}
export default {
  id: 'video-voice-settings', title: 'Complete voice instructions and applied voiceover states', kind: 'user-facing',
  cdpTarget: {urlIncludes: '5186/tests/video-avatar-proof.html'}, preserveTheme: true,
  steps: [
    {name: 'No authorization', run: async ctx => {
      await ctx.prove('No authorization means no automatic synthesis', {voiceover: vo[0],
        action: () => open(ctx, 'auth=off&saved=none'),
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false' && !document.querySelector('[data-testid="voice-generate"]')`), 'Unauthorized synthesis is unavailable');
        }, screenshot: {name:'voice-unconfigured',requireText:['前往授权中心']}});
    }},
    {name: 'Full runtime contract and generate state', run: async ctx => {
      await ctx.prove('Long instructions reach the native runtime intact and a new video can request automatic voiceover', {voiceover: vo[1],
        action: async () => {
          if (!process.env.IPOLLOWORK_CODEX_CONTEXT_PROOF_CLI) throw new Error("Native Codex proof requires IPOLLOWORK_CODEX_CONTEXT_PROOF_CLI");
          const output = execFileSync('bun', ['test','apps/server/src/codex-harness-runtime.test.ts','--test-name-pattern','native Codex receives'], {encoding:'utf8', env:process.env, timeout:40000, stdio:['ignore','pipe','pipe']});
          ctx.output('Native Codex transport proof (isolated local provider)', output || 'Native Codex transport assertion passed. No provider billing.');
          await open(ctx, 'saved=none');
        }, assert: async () => {
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-generate"]')) && !document.querySelector('[data-testid="voice-generate"]').disabled`);
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-mode-result"]').textContent.includes('AI 自动匹配') && !document.querySelector('[data-testid="voice-applied"]')`), 'Do not invent applied voice before synthesis');
        }, screenshot:{name:'voice-generate-ready',requireText:['生成整段配音','AI 自动匹配']}});
    }},
    {name:'Applied voice',run:async ctx=>{
      await ctx.prove('The selector shows the actual automatically matched voice, with no unapplied changes', {voiceover:vo[2],
        action:()=>open(ctx,'applied=single'), assert:async()=>{
          await ctx.waitFor(`document.querySelector('[data-testid="voice-applied"]')?.textContent.includes('龙应沐')`);
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-generate"]').disabled && document.querySelector('[data-testid="voice-mode-result"]').textContent.includes('龙应沐') && !document.querySelector('[data-testid="voice-pending-changes"]')`),'Applied voice differs from the saved automatic default and is not mislabeled');
        },screenshot:{name:'voice-applied-actual',requireText:['已应用：龙应沐','更新整段配音']}});
    }},
    {name:'Pending voice edit',run:async ctx=>{
      await ctx.prove('Choosing a voice preserves the currently applied result until update', {voiceover:vo[3],
        action:async()=>{
          await ctx.trustedClick('[aria-label="选择一个官方音色"]');
          await ctx.waitFor(`Boolean(document.querySelector('[data-voice-id="longanyang"]'))`);
          await ctx.trustedClick('[data-voice-id="longanyang"]');
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-pending-changes"]'))`);
        },assert:async()=>{
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙应沐') && !document.querySelector('[data-testid="voice-generate"]').disabled && !window.avatarProof.requests.some(r=>r.action==='generate-voiceover')`),'Choosing only changes preferences, never overwrites audio');
        },screenshot:{name:'voice-pending',requireText:['已应用：龙应沐','修改尚未应用','龙安洋']}});
    }},
    {name:'Busy and failure preserve audio',run:async ctx=>{
      await ctx.prove('Generation locks controls and failure leaves the old applied voice available for retry', {voiceover:vo[4],
        action:async()=>{
          await ctx.trustedClick('[data-testid="voice-generate"]');
          await ctx.waitFor(`document.querySelector('[data-testid="voice-generate"]').textContent.includes('正在更新')`);
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-generate"]').disabled && document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙应沐') && window.avatarProof.requests.filter(r=>r.action==='generate-voiceover').length === 1`),'A single request starts and existing audio remains');
          await ctx.trustedClick('[data-testid="proof-fail"]');
          await ctx.waitFor(`!document.querySelector('[data-testid="voice-generate"]').disabled`);
        },assert:async()=>{ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙应沐') && !!document.querySelector('[data-testid="voice-pending-changes"]')`),'Failed provider simulation does not replace applied state');},
        screenshot:{name:'voice-failed-preserved',requireText:['已应用：龙应沐','修改尚未应用']}});
    }},
    {name:'Successful replacement',run:async ctx=>{
      await ctx.prove('Only a successful source update changes the displayed applied voice', {voiceover:vo[5],
        action:async()=>{await ctx.trustedClick('[data-testid="voice-generate"]');await ctx.waitFor(`!document.querySelector('[data-testid="proof-finish"]').disabled`);await ctx.trustedClick('[data-testid="proof-finish"]');await ctx.waitFor(`document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙安洋')`);},
        assert:async()=>{ctx.assert(await ctx.eval(`document.querySelector('[data-testid="voice-generate"]').disabled && !document.querySelector('[data-testid="voice-pending-changes"]')`),'Successfully applied settings are clean');},
        screenshot:{name:'voice-updated',requireText:['已应用：龙安洋','更新整段配音'],rejectText:['修改尚未应用']}});
    }},
    {name:'Mixed and legacy voices',run:async ctx=>{
      await ctx.prove('Multiple and unknown applied voices are represented honestly', {voiceover:vo[6],
        action:async()=>{await open(ctx,'applied=mixed');await ctx.waitFor(`document.querySelector('[data-testid="voice-applied"]')?.textContent.includes('多个音色')`);await open(ctx,'applied=single&saved=off');await ctx.waitFor(`Boolean(document.querySelector('[data-testid="voice-applied"]'))`);ctx.assert(await ctx.eval(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false' && Boolean(document.querySelector('[data-testid="voice-generate"]'))`),'Turning off automatic narration retains editing for existing audio');await open(ctx,'applied=legacy');await ctx.waitFor(`document.querySelector('[data-testid="voice-applied"]')?.textContent.includes('音色信息不可用')`);},
        assert:async()=>{ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="voice-applied"]').textContent.includes('龙安洋')`),'Never infer a historical voice from current preferences');},
        screenshot:{name:'voice-legacy',requireText:['音色信息不可用']}});
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
    }},
  ],
};

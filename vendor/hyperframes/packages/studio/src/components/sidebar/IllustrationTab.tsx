import { useState } from "react";

const ILLUSTRATION_SKILLS = [
  { id: "ian-xiaohei-illustrations", label: "小黑手绘插画", repository: "helloianneo/ian-xiaohei-illustrations" },
  { id: "html-infographic", label: "信息图插画", repository: "openai/visualize" },
  { id: "html-concept-explainer", label: "概念解释插画", repository: "ipollowork/faceless-explainer" },
  { id: "html-kinetic-typography", label: "动态排版插画", repository: "heygen-com/hyperframes" },
  { id: "html-svg-path", label: "SVG 路径插画", repository: "heygen-com/hyperframes" },
  { id: "html-3d-space", label: "3D 空间插画", repository: "heygen-com/hyperframes" },
] as const;

export const ILLUSTRATION_SKILL_COUNT = ILLUSTRATION_SKILLS.length;

type IllustrationSkillId = typeof ILLUSTRATION_SKILLS[number]["id"];

export function IllustrationEffectsContent() {
  const [selectedId, setSelectedId] = useState<IllustrationSkillId>(ILLUSTRATION_SKILLS[0].id);
  const selectedSkill = ILLUSTRATION_SKILLS.find((skill) => skill.id === selectedId) ?? ILLUSTRATION_SKILLS[0];
  const askAi = () => {
    window.parent.postMessage(
      {
        type: "ipollowork:hyperframes:illustration-reference",
        illustration: selectedSkill,
      },
      "*",
    );
  };

  return (
    <div className="px-4 pb-4 text-panel-text-1">
      <label className="grid gap-2 text-xs font-medium">
        插画能力
        <select
          value={selectedId}
          onChange={(event) => {
            const next = ILLUSTRATION_SKILLS.find((skill) => skill.id === event.target.value);
            if (next) setSelectedId(next.id);
          }}
          className="h-10 w-full rounded-lg border border-panel-border bg-panel-input px-3 text-[13px] text-panel-text-1 outline-none transition-colors hover:border-panel-text-3 focus:border-panel-accent focus:ring-2 focus:ring-panel-accent/20"
        >
          {ILLUSTRATION_SKILLS.map((skill) => (
            <option key={skill.id} value={skill.id}>{skill.label}</option>
          ))}
        </select>
      </label>
      <p className="mt-3 text-[11px] leading-5 text-panel-text-3">
        AI 会读取当前视频内容，按所选能力生成可编辑的 16:9 自包含 HTML 插画，并保存到当前项目素材库。不需要额外下载 Skill 或配置图片 API Key。
      </p>
      <button
        type="button"
        onClick={askAi}
        className="mt-4 flex h-10 w-full items-center justify-center rounded-lg border border-panel-text-1/15 bg-panel-text-1 px-4 text-sm font-semibold text-panel-bg shadow-sm transition-[opacity,transform,box-shadow] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel-bg active:scale-[0.99]"
      >
        交给 AI 插画
      </button>
    </div>
  );
}

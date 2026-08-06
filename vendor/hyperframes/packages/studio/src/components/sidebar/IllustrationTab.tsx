const IAN_ILLUSTRATION_SKILL = {
  id: "ian-xiaohei-illustrations",
  label: "Ian 小黑正文插画",
  repository: "helloianneo/ian-xiaohei-illustrations",
} as const;

export function IllustrationTab() {
  const askAi = () => {
    window.parent.postMessage(
      {
        type: "ipollowork:hyperframes:illustration-reference",
        illustration: IAN_ILLUSTRATION_SKILL,
      },
      "*",
    );
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4 text-panel-text-1">
      <label className="grid gap-2 text-xs font-medium">
        插画能力
        <select
          value={IAN_ILLUSTRATION_SKILL.id}
          disabled
          className="h-10 w-full cursor-not-allowed rounded-lg border border-panel-border bg-panel-input px-3 text-[13px] text-panel-text-1 opacity-100 outline-none"
        >
          <option value={IAN_ILLUSTRATION_SKILL.id}>{IAN_ILLUSTRATION_SKILL.label}</option>
        </select>
      </label>
      <p className="mt-3 text-[11px] leading-5 text-panel-text-3">
        AI 会读取当前视频内容，生成可直接使用的 16:9 Ian 小黑风格 HTML 插画，并保存到当前项目素材库。不需要额外 API Key。
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

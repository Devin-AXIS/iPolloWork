const studioPreset = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--ipollowork-font-sans)"],
        mono: ["var(--ipollowork-font-mono)"],
      },
      fontSize: {
        "ui-micro": ["0.625rem", { lineHeight: "0.875rem" }],
        "ui-caption": ["0.6875rem", { lineHeight: "1rem" }],
        "ui-compact": ["0.75rem", { lineHeight: "1.125rem" }],
        "ui-control": ["0.8125rem", { lineHeight: "1.125rem" }],
        "ui-body": ["0.875rem", { lineHeight: "1.25rem" }],
        "ui-title-sm": ["1rem", { lineHeight: "1.5rem" }],
        "ui-title": ["1.25rem", { lineHeight: "1.75rem" }],
        "ui-page-title": ["1.5rem", { lineHeight: "2rem" }],
      },
      colors: {
        studio: {
          bg: "var(--hf-studio-bg)",
          surface: "var(--hf-studio-surface)",
          border: "var(--hf-studio-border)",
          text: "var(--hf-studio-text)",
          muted: "var(--hf-studio-muted)",
          accent: "#1FBAC0",
        },
        panel: {
          bg: "var(--hf-panel-bg)",
          // Open inspector-section body — slightly lighter than headers (bg)
          // so the recessed scrollable region reads distinct.
          "bg-inset": "var(--hf-panel-bg-inset)",
          input: "var(--hf-panel-input)",
          surface: "var(--hf-panel-surface)",
          hover: "var(--hf-panel-hover)",
          border: "var(--hf-panel-border)",
          "border-input": "var(--hf-panel-border-input)",
          hairline: "var(--hf-panel-hairline)",
          "text-0": "var(--hf-panel-text-0)",
          "text-1": "var(--hf-panel-text-1)",
          "text-2": "var(--hf-panel-text-2)",
          "text-3": "var(--hf-panel-text-3)",
          "text-4": "var(--hf-panel-text-4)",
          "text-5": "var(--hf-panel-text-5)",
          accent: "#1FBAC0",
          danger: "#EF4444",
          media: "#00E3FF",
          container: "#F5A623",
        },
      },
    },
  },
  plugins: [],
};

export default studioPreset;

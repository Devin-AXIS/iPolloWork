export default async function acmeResearchPlugin() {
  return {
    "tool.execute.before": async () => {
      // The example intentionally has no side effects. Add Acme tools here.
    },
  };
}

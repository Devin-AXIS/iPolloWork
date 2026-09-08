export default async function createVideoConsoleService(runtime) {
  return {
    actions: Object.fromEntries(["status", "jobs", "submit", "recover", "import", "read"].map(action => [action, async input => {
      const response = await runtime.host.callAction(`video-generation/${action}`, input);
      if (!response?.ok || !response.result) throw new Error(response?.message || "视频操作失败，请重试。");
      return response.result;
    }])),
  };
}

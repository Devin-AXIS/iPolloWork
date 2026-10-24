// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useFileTree } from "./useFileTree";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals(); });

test("coalesces concurrent tree refreshes, catches later writes and preserves unchanged tree identity", async () => {
  let tree: ReturnType<typeof useFileTree> | undefined;
  const payload = { files: ["index.html"], compositions: ["index.html"] };
  let settle: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal("fetch", fetcher);
  const events = vi.fn(); vi.stubGlobal("EventSource", events);
  function Probe() { const projectIdRef = useRef("project-a"); tree = useFileTree({ projectId: "project-a", projectIdRef }); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Probe />));
  const initialFiles = tree!.fileTree;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { settle = resolve; }));
  const calls = Array.from({ length: 12 }, () => tree!.refreshFileTree());
  expect(fetcher).toHaveBeenCalledTimes(2); // Initial read plus one in flight.
  await act(async () => { settle!(new Response(JSON.stringify(payload))); await Promise.all(calls); });
  expect(fetcher).toHaveBeenCalledTimes(3); // One trailing read catches writes arriving in flight.
  expect(tree!.fileTree).toBe(initialFiles);
  expect(events).not.toHaveBeenCalled(); // External-change coordinator owns the only event stream.
});

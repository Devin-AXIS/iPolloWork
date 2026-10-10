import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { FONT_EXT } from "../utils/mediaTypes";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";

interface UseFileTreeOptions {
  projectId: string | null;
  projectIdRef: React.RefObject<string | null>;
}

export function useFileTree({ projectId, projectIdRef }: UseFileTreeOptions) {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compositionPaths, setCompositionPaths] = useState<string[]>([]);
  const [fileTreeLoaded, setFileTreeLoaded] = useState(false);
  const refreshRef = useRef<{ projectId: string; promise: Promise<void>; queued: boolean } | null>(null);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) {
      setFileTreeLoaded(false);
      return;
    }
    let cancelled = false;
    setFileTreeLoaded(false);
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[]; dir?: string; compositions?: string[] }) => {
        if (!cancelled && data.files) setFileTree(data.files);
        if (!cancelled && data.compositions) setCompositionPaths(data.compositions);
        if (!cancelled) setProjectDir(typeof data.dir === "string" ? data.dir : null);
      })
      .catch(() => {
        if (!cancelled) setProjectDir(null);
      })
      .finally(() => {
        if (!cancelled) setFileTreeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refreshFileTree = useCallback((): Promise<void> => {
    const pid = projectIdRef.current;
    if (!pid) return Promise.resolve();
    if (refreshRef.current?.projectId === pid) { refreshRef.current.queued = true; return refreshRef.current.promise; }
    const promise: Promise<void> = fetch(`/api/projects/${pid}`).then(res => {
      if (!res.ok) throw new Error("Could not refresh project files");
      return res.json();
    }).then((data: { files?: string[]; compositions?: string[] }) => {
      if (projectIdRef.current !== pid) return;
      if (data.files) {
        const files = data.files;
        setFileTree(current => current.length === files.length && current.every((file, index) => file === files[index]) ? current : files);
      }
      if (data.compositions) {
        const paths = data.compositions;
        setCompositionPaths(current => current.length === paths.length && current.every((file, index) => file === paths[index]) ? current : paths);
      }
    }).finally(() => {
      if (refreshRef.current?.promise !== promise) return;
      const queued = refreshRef.current.queued;
      refreshRef.current = null;
      if (queued && projectIdRef.current === pid) void refreshFileTree().catch(() => {});
    });
    refreshRef.current = { projectId: pid, promise, queued: false };
    return promise;
  }, [projectIdRef]);
  // useExternalFileChangeCoordinator owns the single event subscription and refreshes this tree.

  const compositions = compositionPaths;

  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );

  const fontAssets = useMemo<ImportedFontAsset[]>(
    () =>
      assets
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${projectId}/preview/${asset}`,
        })),
    [assets, projectId],
  );

  return {
    projectDir,
    fileTree,
    setFileTree,
    fileTreeLoaded,
    refreshFileTree,
    compositions,
    assets,
    fontAssets,
  };
}

import { useInfiniteQuery } from "@tanstack/react-query";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";

export function sessionArtifactsQueryKey(baseUrl: string, workspaceId: string, sessionId: string) {
  return ["session-artifacts", baseUrl, workspaceId, sessionId];
}

export function useSessionArtifacts(
  client: iPolloWorkServerClient | null | undefined,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return useInfiniteQuery({
    queryKey: sessionArtifactsQueryKey(client?.baseUrl ?? "", workspaceId ?? "", sessionId ?? ""),
    enabled: Boolean(client && workspaceId && sessionId),
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: number | null }) => {
      if (!client || !workspaceId || !sessionId) throw new Error("Session artifact scope is unavailable");
      return client.listSessionArtifacts(workspaceId, sessionId, pageParam);
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    // Recover results completed while the initiating surface was unmounted.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

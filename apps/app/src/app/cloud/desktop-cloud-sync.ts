import {
  createDenClient,
  readDenSettings,
} from "../lib/den";
import type { iPolloWorkDesktopCloudSyncResult, iPolloWorkServerClient } from "../lib/ipollowork-server";

let desktopCloudSyncQueue: Promise<void> = Promise.resolve();

async function runDesktopCloudSync(input: {
  ipolloworkClient: iPolloWorkServerClient;
  workspaceId: string;
}): Promise<iPolloWorkDesktopCloudSyncResult | null> {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  const activeOrgId = settings.activeOrgId?.trim() ?? "";
  if (!token || !activeOrgId) return null;

  const snapshot = await createDenClient({
    baseUrl: settings.baseUrl,
    token,
  }).getResourceSnapshot(activeOrgId);

  return input.ipolloworkClient.syncDesktopCloud(input.workspaceId, snapshot);
}

export function refreshDesktopCloudSync(input: {
  ipolloworkClient: iPolloWorkServerClient | null | undefined;
  workspaceId: string | null | undefined;
}): Promise<iPolloWorkDesktopCloudSyncResult | null> {
  const ipolloworkClient = input.ipolloworkClient ?? null;
  const workspaceId = input.workspaceId?.trim() ?? "";
  if (!ipolloworkClient || !workspaceId) return Promise.resolve(null);

  const run = desktopCloudSyncQueue.then(() => runDesktopCloudSync({ ipolloworkClient, workspaceId }));
  desktopCloudSyncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

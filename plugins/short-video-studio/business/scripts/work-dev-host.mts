// Optional verification adapter only. Never bundled into the imported plugin.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function workDevHost(root: string) {
  const source = process.env.IPOLLOWORK_SOURCE_ROOT;
  const authConfig = process.env.SHORT_VIDEO_AUTH_CONFIG;
  if (!source || !authConfig) throw new Error('Explicit host source and authorization config are required for Work-backed preview');
  const load = (path: string) => import(pathToFileURL(resolve(source, path)).href);
  const { createAuthorizationAccess } = await load('apps/server/src/authorization-center.ts');
  const { callOpenAiImageGenerationExtensionAction } = await load('apps/server/src/extensions/openai-image-generation.ts');
  const { callVideoGenerationAction } = await load('apps/server/src/extensions/video-generation.ts');
  const { callMediaExtensionAction } = await load('apps/server/src/extensions/media-center.ts');
  const auth = createAuthorizationAccess({ configPath: authConfig });
  // Writes and artifact records remain inside the independent preview root.
  const config = { configPath: resolve('.dev-data/server.json'), workspaces: [{id:'short_video_dev',name:'Short video verification',path:root,workspaceType:'local',engineId:'opencode'}], readOnly:false };
  return { callAction: async (reference: string, args: Record<string,unknown>) => {
    const [plugin, action] = reference.split('/');
    const context = { directory: root, workspaceId: 'short_video_dev', sessionId: 'dev_session' };
    if (plugin === 'openai-image-generation') return callOpenAiImageGenerationExtensionAction(config, auth, action, args, context);
    if (plugin === 'video-generation') return callVideoGenerationAction(config, auth, action, args, context);
    if (plugin === 'media') return callMediaExtensionAction(config, auth, action, args, context);
    throw new Error('Unsupported verification action');
  } };
}

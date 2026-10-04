const string = { type: 'string' }, number = { type: 'number' }, object = { type: 'object' };
export const actions = [
  ['project-list', '列出短片项目', 'read', {}],
  ['project-create', '创建短片项目', 'write', { title: string }],
  ['project-read', '读取短片项目', 'read', { projectId: string }],
  ['project-save', '保存短片项目', 'write', { project: object }],
  ['project-restore', '恢复历史版本', 'write', { projectId: string, revision: number, snapshot: number }],
  ['capabilities', '读取 Work 生成渠道', 'read', {}],
  ['asset-import', '导入工作区素材', 'write', { projectId: string, path: string, name: string, metadata: object }],
  ['asset-upload', '分块上传本地素材', 'write', { projectId: string, uploadId: string, filename: string, total: number, offset: number, data: string, durationSeconds: number, hasAudio: { type: 'boolean' } }],
  ['asset-read', '读取项目素材预览', 'read', { projectId: string, assetId: string, offset: number }],
  ['generate', '通过 Work 渠道生成素材', 'write', { projectId: string, revision: number, nodeId: string, requestId: string }],
  ['generation-status', '查询任务并保存已完成素材', 'write', { projectId: string }],
  ['arrange', '分镜编排到独立轨道', 'write', { projectId: string, revision: number }],
  ['handoff', '交接原生多轨剪辑工程', 'write', { projectId: string, revision: number }],
].map(([id, title, effect, properties]) => ({ id, title, description: title, effect, inputSchema: { type: 'object', properties, additionalProperties: false } }));
export const manifest = {
  schemaVersion: 2, id: 'short-video-studio', name: '短片创作工作台',
  description: '创作画布、剧本分镜、角色素材、Work 模型生成与原生多轨剪辑交接。独立安装，左侧对话控制。',
  category: '设计与创作', defaultEnabled: true,
  source: { format: 'ipollowork-extension-manifest', origin: 'builtin', trusted: true },
  package: { version: '0.1.0', publisher: { id: 'smart-future-school', name: '智慧未来学校' }, compatibility: { ipollowork: '>=0.21.0' }, updateId: 'smart-future-school/short-video-studio' },
  permissions: [
    { id: 'workspace-read', reason: '读取用户选择的短片图片、视频和音频。' },
    { id: 'workspace-write', reason: '保存独立短片项目和新建多轨剪辑工程；不覆盖已有剪辑。' },
  ],
  resources: [
    { type: 'ui', id: 'studio', label: '短片工作台', path: 'ui/studio.html', required: true,
      ui: { uri: 'ui://short-video-studio/studio', mimeType: 'text/html;profile=mcp-app', prefersBorder: false } },
    { type: 'local-service', id: 'service', label: '短片服务', path: 'service/studio.mjs', required: true,
      requires: ['action:openai-image-generation/status', 'action:openai-image-generation/image_generate', 'action:openai-image-generation/image_edit', 'action:video-generation/status', 'action:video-generation/submit', 'action:video-generation/jobs', 'action:video-generation/inspect', 'action:media/status', 'action:media/speech_synthesize_workspace_file'],
      provides: actions.map(a => `action:${a.id}`), actions },
    { type: 'skill', id: 'short-video-studio', label: '短片创作', path: 'skills/short-video-studio', requires: ['service:service'] },
  ],
  contributions: [
    { type: 'workspace-app', ref: 'studio', label: '短片工作台' },
    { type: 'conversation-template', label: '创作短片', description: '打开独立短片工作台，在左侧对话中完成创作。', prompt: '打开短片创作工作台。我希望在画布中规划和生成短片，再交到现有视频工具分轨剪辑。', mode: 'video' },
  ],
  localization: {
    defaultLocale: 'zh',
    translations: {
      en: {
        name: 'Short Video Studio',
        description: 'Plan storyboards, characters and media on a creative canvas, generate assets through Work, and hand off to native multitrack editing.',
        category: 'Design & Creative',
        resources: {
          studio: { label: 'Short Video Studio' },
          service: { label: 'Short Video Service' },
          'short-video-studio': { label: 'Short Video Creation' },
        },
        permissions: {
          'workspace-read': { reason: 'Read short video images, videos and audio selected by the user.' },
          'workspace-write': { reason: 'Save independent short video projects and create multitrack edits without replacing existing edits.' },
        },
      },
    },
  },
};

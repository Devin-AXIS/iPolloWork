const titles = new Map([
  ['deepseek-idesign', { zh: '设计工作台', en: 'Design Studio' }],
  ['deepseek-ivideo', { zh: '视频工作台', en: 'Video Studio' }],
])

export function studioPluginTitle(name: string, language: string): string | undefined {
  return titles.get(name)?.[language.startsWith('zh') ? 'zh' : 'en']
}

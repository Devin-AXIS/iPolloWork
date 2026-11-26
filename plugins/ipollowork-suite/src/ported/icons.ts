import {
  BookOpen, Bot, Music2, Figma, Github, Network, BrainCircuit,
  ListTodo, Images, NotebookPen, Blocks, LibraryBig, Radar, Clapperboard,
  CreditCard, Video, MessageSquareText, BookHeart,
  Tags, MousePointer2, TextCursorInput, ChartNoAxesCombined,
  FileText, Table2, FileDown, Palette, Film,
  type LucideIcon,
} from 'lucide-react'

/** Existing Lucide artwork, shared by each native navigation entry and package artwork. */
export const portedIcons: Readonly<Record<string, LucideIcon>> = {
  'deepseek-idesign': Palette, 'deepseek-ivideo': Film,
  context7: BookOpen, 'deepseek-harness': Bot,
  'douyin-ops': Music2, figma: Figma, github: Github, 'ipollo-onto': Network,
  'jev-decision-model': BrainCircuit, linear: ListTodo, 'media-studio': Images,
  notion: NotebookPen, 'plugin-workshop': Blocks, 'reference-context': LibraryBig,
  sentry: Radar, 'short-video-studio': Clapperboard, stripe: CreditCard,
  'wechat-channels-ops': Video, 'wechat-official': MessageSquareText,
  'xiaohongshu-ops': BookHeart,
  'data-annotation': Tags, 'operation-recorder': MousePointer2,
  'experimental-session-titles-bundle': TextCursorInput, 'decision-intelligence': ChartNoAxesCombined,
  'markdown-editor': FileText, 'excel-editor': Table2, 'conversation-export': FileDown,
}

export function pluginGlyph(id: string): LucideIcon {
  return portedIcons[id.replace(/^@(?:ipollo|deepseek-ai)\/dsh-/, '')] ?? Blocks
}

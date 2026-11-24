import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { label, type Language } from '../browser.ts';
import { findSlashCommand, replaceLinePrefix, replaceSlashCommand, wrapMarkdownSelectionByLine,
  type MarkdownEdit, type SlashCommandMatch } from './markdown-editor-commands.ts';
import { markdownLivePreview } from './markdown-live-preview.ts';
import { formatMarkdownImage } from './markdown-rich-content.ts';
import { resolveMarkdownOverlayPosition } from './markdown-overlay-position.ts';

const blocks = [
  ['正文', 'Text', 'text paragraph', '', 'line'],
  ['一级标题', 'Heading 1', 'h1 title', '# ', 'line'],
  ['二级标题', 'Heading 2', 'h2 subtitle', '## ', 'line'],
  ['三级标题', 'Heading 3', 'h3', '### ', 'line'],
  ['图片', 'Image', 'image photo', '', 'image'],
  ['表格', 'Table', 'table grid', '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |', 'insert'],
  ['代码块', 'Code block', 'code fence', '```\n\n```', 'insert'],
  ['无序列表', 'Bulleted list', 'bullet list', '- ', 'line'],
  ['有序列表', 'Numbered list', 'number list', '1. ', 'line'],
  ['待办列表', 'To-do list', 'todo task', '- [ ] ', 'line'],
  ['引用', 'Quote', 'quote', '> ', 'line'],
  ['分隔线', 'Divider', 'divider', '---', 'insert'],
] as const;
const formatting = [
  ['粗体', 'Bold', '**', '**'], ['斜体', 'Italic', '*', '*'], ['删除线', 'Strikethrough', '~~', '~~'],
  ['行内代码', 'Inline code', '`', '`'], ['链接', 'Link', '[', '](https://)'],
] as const;
type Block = (typeof blocks)[number];
type ImageEdit = { from: number; to: number; alt: string; url: string };

function update(view: EditorView, edit: MarkdownEdit) {
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: edit.selection, scrollIntoView: true });
  view.focus();
}

export function RichMarkdown({ value, change, language, resolveImage }: {
  value: string; change(value: string): void; language: Language; resolveImage(value: string): string | undefined;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const frame = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const initial = useRef(value);
  const onChange = useRef(change);
  onChange.current = change;
  const [, render] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [image, setImage] = useState<ImageEdit>();
  const [imageError, setImageError] = useState('');
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!mount.current) return;
    const view = new EditorView({ parent: mount.current, state: EditorState.create({ doc: initial.current, extensions: [
      history(), markdown(), markdownLivePreview(resolveImage), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown', 'aria-multiline': 'true' }),
      EditorView.updateListener.of(event => {
        if (event.docChanged) { onChange.current(event.state.doc.toString()); setIndex(0); setDismissed(''); }
        if (event.docChanged || event.selectionSet || event.viewportChanged || event.focusChanged) render(value => value + 1);
      }),
    ] }) });
    editor.current = view;
    const onScroll = () => render(value => value + 1);
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    view.focus();
    return () => { view.scrollDOM.removeEventListener('scroll', onScroll); view.destroy(); editor.current = null; };
  }, [resolveImage]);

  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false) });
  }, [value]);

  const view = editor.current;
  const selection = view?.state.selection.main;
  const slash = !image && view?.hasFocus && selection?.empty ? findSlashCommand(view.state.doc.toString(), selection.head) : null;
  const slashKey = slash ? `${slash.from}:${slash.to}:${slash.query}` : '';
  const commands = slash && slashKey !== dismissed ? blocks.filter(([zh, en, aliases]) =>
    `${zh} ${en} ${aliases}`.toLowerCase().includes(slash.query.toLowerCase())) : [];
  const toolbar = !image && selection && !selection.empty && view?.hasFocus;

  function anchor(at: number, width: number, height: number) {
    const rect = frame.current?.getBoundingClientRect();
    const coords = view?.coordsAtPos(at);
    if (!rect || !coords || coords.bottom < rect.top || coords.top > rect.bottom) return;
    return resolveMarkdownOverlayPosition({ ...coords, width: coords.right - coords.left, height: coords.bottom - coords.top }, rect, { width, height });
  }

  function choose(command: Block, match: SlashCommandMatch | null) {
    if (!view || !selection) return;
    const snippet = command[0] === '表格' && language === 'en' ? '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |' : command[3];
    if (command[4] === 'image') {
      setImage({ from: match?.from ?? selection.from, to: match?.to ?? selection.to, alt: '', url: '' });
      setImageError('');
    } else if (match) update(view, replaceSlashCommand(match, snippet));
    else if (command[4] === 'line') update(view, replaceLinePrefix(view.state.doc.toString(), selection.head, snippet));
  }

  async function readImage(file?: File) {
    if (!file || !image) return;
    if (!/^image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml)$/.test(file.type) || file.size > 750_000) {
      setImageError(t('请选择 750 KB 以内的受支持图片。', 'Choose a supported image up to 750 KB.'));
      return;
    }
    setReading(true); setImageError('');
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setImage(current => current ? { ...current, url, alt: current.alt || file.name.replace(/\.[^.]+$/, '') } : undefined);
    } catch { setImageError(t('图片读取失败。', 'Could not read the image.')); }
    finally { setReading(false); }
  }

  function saveImage(event: FormEvent) {
    event.preventDefault();
    if (!image || !view) return;
    const url = image.url.trim();
    if (!/^(?:https:\/\/[^\s]+|data:image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml);base64,[a-z\d+/=]+)$/i.test(url) && !resolveImage(url)) {
      setImageError(t('请输入工作区图片路径或 HTTPS 地址，也可以选择本地图片。',
        'Enter a workspace image path or HTTPS URL, or choose a local image.'));
      return;
    }
    const insert = formatMarkdownImage(image.alt, url);
    update(view, { from: image.from, to: image.to, insert, selection: { anchor: image.from + insert.length } });
    setImage(undefined);
  }

  const slashPosition = slash && slashKey !== dismissed ? anchor(slash.from, 238, Math.min(280, commands.length * 31 + 34)) : undefined;
  const toolbarPosition = toolbar && selection ? anchor(selection.from, 315, 36) : undefined;
  return <div className="ipw-file-markdown" ref={frame} onClick={event => {
    if (!(event.target instanceof HTMLElement)) return;
    const widget = event.target.closest<HTMLElement>('[data-markdown-image-action]')?.closest<HTMLElement>('[data-markdown-image]');
    if (!widget) return;
    const from = Number(widget.dataset.markdownImageFrom), to = Number(widget.dataset.markdownImageTo);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || !view || from < 0 || to <= from || to > view.state.doc.length) return;
    setImage({ from, to, alt: widget.dataset.markdownImageAlt ?? '', url: widget.dataset.markdownImageUrl ?? '' });
    setImageError('');
  }} onKeyDownCapture={event => {
    if (!slash || !slashPosition || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); setDismissed(slashKey); }
    if (!commands.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') { const item = commands[index % commands.length]; if (item) choose(item, slash); }
    else setIndex(current => (current + commands.length + (event.key === 'ArrowDown' ? 1 : -1)) % commands.length);
  }}>
    <div ref={mount} className="ipw-file-markdown-body" />
    {slash && slashPosition && <div className="ipw-file-markdown-popover" style={{ left: slashPosition.left, top: slashPosition.top, maxHeight: slashPosition.maxHeight }}
      role="group" aria-label={t('插入内容', 'Insert block')} onMouseDown={event => event.preventDefault()}>
      <strong>{t('插入内容', 'Basic blocks')}</strong>
      {commands.map((command, choice) => <Button size="sm" key={command[1]} aria-pressed={choice === index % commands.length}
        onClick={() => choose(command, slash)}>{t(command[0], command[1])}</Button>)}
      {!commands.length && <span>{t('无匹配项', 'No matching blocks')}</span>}
    </div>}
    {toolbarPosition && view && selection && <div className="ipw-file-markdown-popover ipw-file-selection" style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
      role="group" aria-label={t('选区格式', 'Selection formatting')} onMouseDown={event => event.preventDefault()}>
      {formatting.map(([zh, en, before, after]) => <Button size="sm" key={en}
        onClick={() => update(view, wrapMarkdownSelectionByLine(view.state.doc.toString(), selection.from, selection.to, before, after, ''))}>{t(zh, en)}</Button>)}
    </div>}
    {image && <form className="ipw-file-image-form" onSubmit={saveImage}>
      <label>{t('图片地址', 'Image URL')}<Input type="text" value={image.url} onChange={event => setImage({ ...image, url: event.target.value })} /></label>
      <label>{t('图片描述', 'Description')}<Input value={image.alt} onChange={event => setImage({ ...image, alt: event.target.value })} /></label>
      <label>{t('选择本地图片', 'Choose local image')}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/svg+xml"
        disabled={reading} onChange={event => void readImage(event.target.files?.[0])} /></label>
      {imageError && <p role="alert">{imageError}</p>}
      <div className="ipw-file-actions"><Button size="sm" onClick={() => { setImage(undefined); view?.focus(); }}>{t('取消', 'Cancel')}</Button>
        <Button size="sm" type="submit" variant="primary" disabled={reading || !image.url}>{t('确认图片', 'Apply image')}</Button></div>
    </form>}
  </div>;
}

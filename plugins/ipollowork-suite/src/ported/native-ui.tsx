import React, { createContext, useContext, useEffect, useState, type ReactNode, type HTMLAttributes } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button as NativeButton, Input, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { Puzzle, Plus, X, Trash2, Search, RefreshCw, ChevronDown, Settings } from 'lucide-react'

const SelectState = createContext({ value: '', options: [] as { value: string; label: string }[], disabled: false, change: (_value: string) => {} })
const TabsState = createContext({ value: '', change: (_value: string) => {} })
const DialogState = createContext({ open: false, close: () => {} })
const CollapseState = createContext({ open: false, toggle: () => {} })
function Toaster() {
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | undefined; id: number }>()
  useEffect(() => { const receive = (event: Event) => { if (event instanceof CustomEvent && typeof event.detail?.text === 'string') setNotice({ text: event.detail.text, tone: event.detail.success ? 'success' : undefined, id: Date.now() }) }; window.addEventListener('ipollo-ported-toast', receive); return () => window.removeEventListener('ipollo-ported-toast', receive) }, [])
  return notice ? <Toast key={notice.id} text={notice.text} {...(notice.tone ? { tone: notice.tone } : {})} onDone={() => setNotice(undefined)}/> : null
}
const block = (tag: 'div' | 'h2' | 'p' = 'div', slot?: string) => {
  const Component = React.forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { variant?: string }>(function Block({ children, variant, ...props }, ref) { return React.createElement(tag, { ...props, ref, ...(slot ? { 'data-slot': slot } : {}), ...(variant ? { 'data-variant': variant } : {}) }, children) })
  Component.displayName = slot
  return Component
}
const Button = React.forwardRef<HTMLButtonElement, Omit<React.ComponentProps<typeof NativeButton>, 'variant'> & { variant?: string; render?: React.ReactElement<React.AnchorHTMLAttributes<HTMLAnchorElement>> }>(function Button({ variant = 'default', render, ...props }, ref) {
  const mapped = variant === 'default' ? 'primary' : variant === 'secondary' ? 'ghost' : variant === 'link' ? 'toolbar' : variant === 'destructive' ? 'outline' : variant === 'primary' || variant === 'outline' || variant === 'toolbar' ? variant : 'ghost'
  if (React.isValidElement(render) && render.type === 'a') return React.createElement('a', { ...props, ...render.props, ref, className: ['ipw-ported-button-link', props.className, render.props.className].filter(Boolean).join(' '), 'data-variant': mapped }, props.children ?? render.props.children)
  return <NativeButton {...props} ref={ref} variant={mapped} {...(variant === 'destructive' ? { 'data-ipw-danger': true } : {})}/>
})
function modalBody(children: ReactNode): { title: string; content: ReactNode } {
  let title = ''
  const text = (node: ReactNode): string => React.Children.toArray(node).map(child => React.isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('')
  const visit = (nodes: ReactNode): ReactNode => React.Children.map(nodes, child => {
    if (!React.isValidElement<{ children?: ReactNode }>(child)) return child
    const type: unknown = child.type
    if (typeof type === 'object' && type && 'displayName' in type && type.displayName === 'dialog-title') { title ||= text(child.props.children); return null }
    return child.props.children === undefined ? child : React.cloneElement(child, { children: visit(child.props.children) })
  })
  const content = visit(children)
  return { title, content }
}
const overlayStyle = `.ipw-ported-overlay{font:13px/1.5 var(--dsw-font-family,system-ui);color:var(--dsw-alias-label-primary);max-height:calc(100dvh - 48px);overflow:auto}
.ipw-ported-overlay form,.ipw-ported-overlay [role=form],.ipw-ported-overlay [data-slot=field]{display:grid;gap:12px;min-width:0}.ipw-ported-overlay [data-slot=field]{gap:6px}
.ipw-ported-overlay [data-slot=dialog-header]{display:grid;gap:6px}.ipw-ported-overlay [data-slot=dialog-description]{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0 0 16px}
.ipw-ported-overlay [data-slot=dialog-footer]{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:8px}.ipw-ported-overlay input{width:100%;min-width:0}
.ipw-ported-overlay [data-slot=field-label]{font-weight:500}.ipw-ported-overlay [data-slot=field-error], [data-ipw-danger=true]{color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary))}
.ipw-ported-overlay textarea,.ipw-ported-overlay select{font:inherit;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;width:100%;box-sizing:border-box}`
function optionsFrom(children: ReactNode): { value: string; label: string }[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{ value?: string; children?: ReactNode }>(child)) return []
    if (child.type === SelectItem && typeof child.props.value === 'string') return [{ value: child.props.value, label: React.Children.toArray(child.props.children).filter(value => typeof value === 'string' || typeof value === 'number').join('') }]
    return optionsFrom(child.props.children)
  })
}
const SelectItem = (_props: { value: string; children?: ReactNode }) => null
const Select = ({ value, items, disabled, onValueChange, children }: { value: string; items?: { value: string; label: string }[]; disabled?: boolean; onValueChange: (value: string) => void; children: ReactNode }) => <SelectState.Provider value={{ value, options: items ?? optionsFrom(children), disabled: Boolean(disabled), change: onValueChange }}>{children}</SelectState.Provider>
const SelectTrigger = React.forwardRef<HTMLSelectElement, HTMLAttributes<HTMLSelectElement>>(function Trigger(props, ref) {
  const state = useContext(SelectState)
  return <select {...props} data-slot="select-trigger" ref={ref} value={state.value} disabled={state.disabled || !state.options.length} onChange={event => state.change(event.target.value)}>{!state.options.length && <option value="">—</option>}{state.options.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select>
})
function DialogContent({ children, id, closeLabel }: { children: ReactNode; id?: string; closeLabel: string }) {
  const state = useContext(DialogState)
  const body = modalBody(children)
  return <Modal open={state.open} title={body.title} className="ipw-ported-overlay" closeLabel={closeLabel} onClose={state.close}><div id={id}>{body.content}</div></Modal>
}
function Collapsible({ open, defaultOpen, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void; children?: ReactNode }) {
  const [local, setLocal] = useState(Boolean(defaultOpen)), current = open ?? local
  return <CollapseState.Provider value={{ open: current, toggle: () => { setLocal(!current); onOpenChange?.(!current) } }}>{children}</CollapseState.Provider>
}
function CollapsibleTrigger({ children }: { children?: ReactNode }) { const state = useContext(CollapseState); return <Button variant="ghost" aria-expanded={state.open} onClick={state.toggle}>{children}</Button> }
function CollapsibleContent({ children }: { children?: ReactNode }) { const state = useContext(CollapseState); return state.open ? <div>{children}</div> : null }
/** Compatibility for business UI widgets, implemented with current native primitives. */
export function installFrameUi(): () => void {
  const stateKey = Symbol.for('ipollo.ported.native-ui'), owner = Symbol('native-ui-owner')
  const priorState: unknown = Reflect.get(window, stateKey)
  if (priorState && typeof priorState === 'object' && 'owners' in priorState && priorState.owners instanceof Set && 'dispose' in priorState && typeof priorState.dispose === 'function') {
    const owners = priorState.owners, dispose = priorState.dispose
    owners.add(owner)
    return () => { owners.delete(owner); if (!owners.size) dispose() }
  }
  const previous: unknown = Reflect.get(window, '__ipolloPortedUi')
  const style = document.createElement('style'); style.dataset.ipwPortedOverlay = ''; style.textContent = overlayStyle; document.head.append(style)
  const owners = new Set([owner]), roots = new Map<Document, Set<Root>>()
  const disposeDocument = (document: Document) => { for (const root of roots.get(document) ?? []) root.unmount(); roots.delete(document) }
  const toast = (text: string, success: boolean) => window.dispatchEvent(new CustomEvent('ipollo-ported-toast', { detail: { text, success } }))
  const runtime = {
    React, createRoot: (element: Element) => {
      const root = createRoot(element), document = element.ownerDocument
      let active = roots.get(document); if (!active) { active = new Set(); roots.set(document, active) }; active.add(root)
      return { render: root.render.bind(root), unmount() { active.delete(root); root.unmount() } }
    }, disposeDocument, Button, Input,
    Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => <textarea {...props} ref={ref}/>),
    enhance: (_element: Element) => {}, observe: (_element: Element) => () => {},
    Icon: ({ name, size = 16 }: { name: string; size?: number | string }) => { const icons: Record<string, typeof Puzzle> = { plus: Plus, Plus, x: X, X, trash: Trash2, Trash2, 'trash-2': Trash2, search: Search, Search, refresh: RefreshCw, RefreshCw, 'refresh-cw': RefreshCw, 'chevron-down': ChevronDown, ChevronDown, settings: Settings, Settings }; const Icon = icons[name] ?? Puzzle; const sizes: Record<string, number> = { s: 12, sm: 14, m: 16, l: 20, xl: 24 }; return <Icon size={typeof size === 'number' ? size : sizes[size] ?? 16} aria-hidden="true"/> },
    Select, SelectTrigger, SelectValue: () => null, SelectContent: () => null, SelectItem,
    Tabs: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <TabsState.Provider value={{ value, change: onValueChange }}>{children}</TabsState.Provider>,
    TabsList: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props} role="tablist">{children}</div>,
    TabsTrigger: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }>(function Trigger({ value, ...props }, ref) { const state = useContext(TabsState); return <Button {...props} variant="ghost" ref={ref} role="tab" aria-selected={state.value === value} onClick={() => state.change(value)}/> }),
    TabsContent: React.forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { value: string }>(function Content({ value, ...props }, ref) { const state = useContext(TabsState); return <div {...props} ref={ref} role="tabpanel" hidden={state.value !== value}/> }),
    Checkbox: React.forwardRef<HTMLInputElement, { checked: boolean; onCheckedChange: (checked: boolean) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>>(function Checkbox({ onCheckedChange, ...props }, ref) { return <input {...props} ref={ref} type="checkbox" onChange={event => onCheckedChange(event.target.checked)}/> }),
    Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean, detail: { cancel(): void }) => void; children: ReactNode }) => <DialogState.Provider value={{ open, close: () => onOpenChange(false, { cancel() {} }) }}>{children}</DialogState.Provider>,
    DialogContent, DialogHeader: block('div', 'dialog-header'), DialogTitle: block('h2', 'dialog-title'), DialogDescription: block('p', 'dialog-description'), DialogFooter: block('div', 'dialog-footer'),
    Empty: block('div', 'empty'), EmptyHeader: block('div', 'empty-header'), EmptyTitle: block('h2', 'empty-title'), EmptyDescription: block('p', 'empty-description'), EmptyContent: block('div', 'empty-content'),
    Field: React.forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => <div {...props} ref={ref} data-slot="field"/>), FieldLabel: React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>((props, ref) => <label {...props} ref={ref} data-slot="field-label"/>), FieldError: block('p', 'field-error'), Progress: ({ value }: { value: number }) => <progress data-slot="progress" value={value} max={100}/>,
    Table: (props: React.TableHTMLAttributes<HTMLTableElement>) => <table {...props}/>, TableHeader: (props: HTMLAttributes<HTMLTableSectionElement>) => <thead {...props}/>, TableBody: (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props}/>, TableRow: (props: HTMLAttributes<HTMLTableRowElement>) => <tr {...props}/>, TableHead: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...props}/>, TableCell: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...props}/>,
    Collapsible, CollapsibleTrigger, CollapsibleContent,
    AlertDialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) => <DialogState.Provider value={{ open, close: () => onOpenChange(false) }}>{children}</DialogState.Provider>,
    AlertDialogContent: DialogContent, AlertDialogTitle: block('h2', 'dialog-title'), AlertDialogDescription: block('p', 'dialog-description'), AlertDialogFooter: block('div', 'dialog-footer'), AlertDialogAction: Button, AlertDialogCancel: React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>((props, ref) => <Button variant="ghost" {...props} ref={ref}/>),
    Alert: block('div', 'alert'), AlertTitle: block('h2', 'alert-title'), AlertDescription: block('p', 'alert-description'), AlertAction: block('div', 'alert-action'), Badge: block('div', 'badge'), Skeleton: block('div', 'skeleton'),
    Toaster, toast: { success: (text: string) => toast(text, true), error: (text: string) => toast(text, false) },
  }
  Reflect.set(window, '__ipolloPortedUi', runtime)
  const dispose = () => { style.remove(); for (const document of roots.keys()) disposeDocument(document); if (Reflect.get(window, '__ipolloPortedUi') === runtime) { if (previous === undefined) Reflect.deleteProperty(window, '__ipolloPortedUi'); else Reflect.set(window, '__ipolloPortedUi', previous) }; Reflect.deleteProperty(window, stateKey) }
  Reflect.set(window, stateKey, { owners, dispose })
  return () => { owners.delete(owner); if (!owners.size) dispose() }
}

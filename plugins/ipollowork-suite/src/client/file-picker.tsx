import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { Button, IconUploadOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './suite.module.css'

interface FilePickerProps {
  label: string
  hint?: string
  language: string
  accept?: string
  name?: string
  multiple?: boolean
  required?: boolean
  disabled?: boolean
  files?: readonly File[]
  onSelect(files: File[], input: HTMLInputElement): void
}

/** One file selection surface; selected files remain local until the form is submitted. */
export function FilePicker({ label, hint, language, accept, name, multiple = false, required = false, disabled = false, files, onSelect }: FilePickerProps) {
  const id = useId(), input = useRef<HTMLInputElement>(null), choose = useRef<HTMLButtonElement>(null)
  const [selection, setSelection] = useState<File[]>([]), [dragging, setDragging] = useState(false), [error, setError] = useState('')
  const selected = files ?? selection
  const zh = language.startsWith('zh')
  useEffect(() => {
    if (files?.length === 0 && input.current) input.current.value = ''
  }, [files])
  const update = (next: File[], replaceInput: boolean) => {
    const control = input.current
    if (!control || disabled) return
    if (replaceInput) {
      if (next.length === 0) control.value = ''
      else {
        const transfer = new DataTransfer()
        for (const file of next) transfer.items.add(file)
        control.files = transfer.files
      }
    }
    setError('')
    onSelect(next, control)
    setSelection(Array.from(control.files ?? []))
  }
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    if (disabled) return
    const dropped = Array.from(event.dataTransfer.files)
    if (!dropped.length) return
    update(multiple ? dropped : dropped.slice(0, 1), true)
  }
  const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return <div className={css.filePickerField} role="group" aria-labelledby={id + '-label'}>
    <span id={id + '-label'} className={css.filePickerLabel}>{label}{required && <span aria-hidden="true"> *</span>}</span>
    <div className={css.filePickerZone} data-dragging={dragging || undefined} data-disabled={disabled || undefined}
      onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(!disabled) } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy' } }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
      onDrop={drop}>
      <input ref={input} className={css.srOnly} data-ipw-file-input="" id={id} name={name} type="file" accept={accept} multiple={multiple}
        required={required} disabled={disabled} tabIndex={-1} aria-hidden="true" aria-labelledby={id + '-label'} aria-describedby={hint ? id + '-hint' : undefined}
        onInvalid={event => { event.preventDefault(); setError(zh ? '请先选择文件' : 'Choose a file to continue'); choose.current?.focus() }}
        onChange={event => { if (event.currentTarget.files?.length) update(Array.from(event.currentTarget.files), false) }} />
      <div className={css.filePickerPrompt}>
        <Button ref={choose} type="button" variant="outline" disabled={disabled} icon={<IconUploadOutlineRegular size={16}/>}
          aria-describedby={hint ? id + '-hint' : undefined}
          onClick={() => input.current?.click()}>{selected.length ? (zh ? '重新选择' : 'Choose again') : (zh ? '选择文件' : 'Choose files')}</Button>
        <span className={css.filePickerHelp}>{zh ? (multiple ? '支持拖放多个文件' : '也可将文件拖放到此处') : (multiple ? 'Or drop files here' : 'Or drop a file here')}</span>
      </div>
      {selected.length > 0 && <ul className={css.filePickerList} aria-label={zh ? '已选择的文件' : 'Selected files'}>
        {selected.map((file, index) => <li key={`${file.name}:${file.size}:${file.lastModified}:${index}`}>
          <span className={css.filePickerName} title={file.name}>{file.name}<small>{size(file.size)}</small></span>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={(zh ? '移除 ' : 'Remove ') + file.name}
            onClick={() => update(selected.filter((_, at) => at !== index), true)}>{zh ? '移除' : 'Remove'}</Button>
        </li>)}
      </ul>}
    </div>
    {hint && <small className={css.filePickerHelp} id={id + '-hint'}>{hint}</small>}
    {error && <p role="alert" className={css.formError}>{error}</p>}
  </div>
}

import { translate as tr, useLocale } from '../i18n'
import { translateMessage } from '../i18n'
import { useId, isValidElement, cloneElement, type ReactElement, type ReactNode } from 'react'
import { Dialog, Callout, TextField, Spinner } from '@radix-ui/themes'
import { Cross2Icon, InfoCircledIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons'

export function ErrorNotice({ error }: { error: string }) {
  useLocale()
  return error ? (
    <Callout.Root color="red" size="1">
      <Callout.Icon>
        <InfoCircledIcon />
      </Callout.Icon>
      <Callout.Text>{translateMessage(error)}</Callout.Text>
    </Callout.Root>
  ) : null
}
export function FormLabel({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="form-label" role="group" aria-labelledby={id}>
      <span id={id}>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-labelledby'?: string }>, {
            'aria-labelledby': id,
          })
        : children}
    </div>
  )
}
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  wide = false,
}: {
  title: string
  description: string
  open: boolean
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useLocale()
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <Dialog.Content
        maxWidth={wide ? '600px' : '460px'}
        style={{ maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto' }}
      >
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="5">
          {description}
        </Dialog.Description>
        <Dialog.Close>
          <button className="dialog-close" aria-label={tr('关闭')}>
            <Cross2Icon />
          </button>
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** A right-hand detail surface with Radix focus, dismissal and keyboard handling. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Content className="detail-sheet" aria-describedby={undefined}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function SearchInput({
  value,
  onChange,
  label,
  placeholder = label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
}) {
  return (
    <TextField.Root
      size="2"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <TextField.Slot>
        <MagnifyingGlassIcon />
      </TextField.Slot>
    </TextField.Root>
  )
}
export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div className="center-loading">
      <Spinner size="3" />
      <p>{children}</p>
    </div>
  )
}
export function PageHeading({
  title,
  description,
  before,
  action,
}: {
  title: string
  description: string
  before?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        {before}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

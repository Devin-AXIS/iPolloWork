import type { ComponentProps } from 'react'
import { Modal as NativeModal } from '@deepseek-ai/dsh-client-ui-primitives'

/** Keep product dialogs within the native overlay and scroll their content when needed. */
export function Modal(props: ComponentProps<typeof NativeModal>) {
  const { className, contentClassName, headless } = props
  return <NativeModal
    {...props}
    className={['ipw-modal', headless && 'ipw-modal-headless', className].filter(Boolean).join(' ')}
    contentClassName={['ipw-modal-content', contentClassName].filter(Boolean).join(' ')}
  />
}

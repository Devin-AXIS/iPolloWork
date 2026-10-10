import * as React from "react"
import { Toaster as Sonner, toast as sonnerToast, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon, XIcon, type LucideIcon } from "lucide-react"
const CloseLabel = React.createContext("Close");

type ToasterStyle = React.CSSProperties & {
  "--normal-bg": string
  "--normal-text": string
  "--normal-border": string
  "--border-radius": string
}

const Toaster = ({ closeLabel = "Close", theme, ...props }: ToasterProps & { closeLabel?: string }) => {
  const [localTheme, setLocalTheme] = React.useState<"light" | "dark">(() => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  React.useEffect(() => {
    if (theme !== undefined) return;
    const observer = new MutationObserver(() => setLocalTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [theme]);
  const toasterStyle: ToasterStyle = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
  }

  return (
    <CloseLabel.Provider value={closeLabel}><Sonner
      theme={theme ?? localTheme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={toasterStyle}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    /></CloseLabel.Provider>
  )
}

type ToastType = "default" | "success" | "info" | "warning" | "error"

export interface ToastAction {
  label: React.ReactNode
  onClick: () => void
}

export interface ToastOptions {
  id?: string | number
  description?: React.ReactNode
  action?: ToastAction
  cancel?: ToastAction
  duration?: number
}

const TOAST_ICONS: Record<ToastType, LucideIcon> = {
  default: InfoIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: OctagonXIcon,
}

const accentColor: Record<ToastType, string> = {
  default: "bg-sky-11",
  info: "bg-sky-11",
  success: "bg-green-11",
  warning: "bg-amber-11",
  error: "bg-red-11",
}

const borderColor: Record<ToastType, string> = {
  default: "border-sky-11",
  info: "border-sky-11",
  success: "border-green-11",
  warning: "border-amber-11",
  error: "border-red-11",
}

function ToastIcon({ type }: { type: ToastType }) {
  const Icon = TOAST_ICONS[type]
  return <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-background ${accentColor[type]}`}><Icon className="size-4" aria-hidden /></span>
}

interface ToastCardProps {
  id: string | number
  type: ToastType
  title: React.ReactNode
  description?: React.ReactNode
  action?: ToastAction
  cancel?: ToastAction
}

function ToastCard({ id, type, title, description, action, cancel }: ToastCardProps) {
  const closeLabel = React.useContext(CloseLabel);
  const dismiss = (event: React.SyntheticEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    sonnerToast.dismiss(id)
  }

  return (
    <div data-slot="toast-card" className={`relative flex w-full min-w-0 items-center gap-2 rounded-[10px] border bg-popover p-3 text-popover-foreground shadow-none md:max-w-sm ${borderColor[type]}`}>
      <ToastIcon type={type} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold leading-5">{title}</p>
        {description ? <p className="text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
        {action || cancel ? <div data-slot="toast-actions" className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          {action ? <button type="button" className={`min-h-7 px-1 text-[13px] font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring ${type === "error" ? "text-destructive" : "text-foreground"}`} onClick={() => { action.onClick(); sonnerToast.dismiss(id) }}>{action.label}</button> : null}
          {cancel ? <button type="button" className="min-h-7 px-1 text-[13px] text-muted-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { cancel.onClick(); sonnerToast.dismiss(id) }}>{cancel.label}</button> : null}
        </div> : null}
      </div>
      <button type="button" aria-label="Close notification" title={closeLabel} className="relative z-50 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onPointerDown={dismiss} onClick={dismiss}><XIcon className="size-4" aria-hidden /></button>
    </div>
  )
}

function showToast(type: ToastType, message: React.ReactNode, options?: ToastOptions) {
  const notification = options?.action === undefined && options?.cancel === undefined;

  return sonnerToast.custom(
    (id) => (
      <ToastCard
        id={id}
        type={type}
        title={message}
        description={options?.description}
        action={options?.action}
        cancel={options?.cancel}
      />
    ),
    {
      ...(options?.id !== undefined ? { id: options.id } : {}),
      duration: options?.duration,
      description: undefined,
      action: undefined,
      cancel: undefined,
      position: notification ? "top-center" : "bottom-right",
    },
  )
}

const toast = Object.assign(
  (message: React.ReactNode, options?: ToastOptions) => showToast("default", message, options),
  {
    success: (message: React.ReactNode, options?: ToastOptions) => showToast("success", message, options),
    info: (message: React.ReactNode, options?: ToastOptions) => showToast("info", message, options),
    warning: (message: React.ReactNode, options?: ToastOptions) => showToast("warning", message, options),
    error: (message: React.ReactNode, options?: ToastOptions) => showToast("error", message, options),
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  },
)

export { Toaster, toast }

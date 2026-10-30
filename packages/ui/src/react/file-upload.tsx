import * as React from "react";
import { Button } from "./controls";
import { Icon } from "./icon";
import { Progress } from "./progress";
import { cn } from "../common/control-styles";

export type FileValidation = { accept?: string; maxSize?: number; multiple?: boolean };
export type FileValidationMessages = { invalidType: string; tooLarge: string; empty: string; tooMany: string };

export function validateFileSelection(files: readonly File[], options: FileValidation, messages: FileValidationMessages): string | null {
  if (!options.multiple && files.length > 1) return messages.tooMany;
  const accepted = options.accept?.split(",").map(type => type.trim().toLowerCase()).filter(Boolean);
  for (const file of files) {
    if (file.size === 0) return messages.empty;
    if (options.maxSize !== undefined && file.size > options.maxSize) return messages.tooLarge;
    if (accepted?.length && !accepted.some(type => type.startsWith(".") ? file.name.toLowerCase().endsWith(type)
      : type.endsWith("/*") ? file.type.toLowerCase().startsWith(type.slice(0, -1)) : file.type.toLowerCase() === type)) return messages.invalidType;
  }
  return null;
}

export function FileUpload({ label, description, children, className, disabled, accept, multiple = false, maxSize, messages, validate, onFilesSelected, onError, ...props }:
  Omit<React.ComponentProps<"div">, "onError"> & FileValidation & {
    label: string; description?: string; disabled?: boolean; messages: FileValidationMessages;
    validate?: (file: File) => string | null;
    onFilesSelected: (files: File[]) => void;
    onError: (message: string) => void;
  }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const select = (files: File[]) => {
    if (disabled || !files.length) return;
    const error = validateFileSelection(files, { accept, maxSize, multiple }, messages) || files.map(file => validate?.(file)).find(Boolean);
    onError(error || "");
    if (!error) onFilesSelected(files);
  };
  return <div {...props} data-slot="file-upload" className={cn("min-w-0", className)}
    onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); select(Array.from(event.dataTransfer.files)); }}>
    <input ref={input} type="file" hidden aria-label={label} accept={accept} multiple={multiple} disabled={disabled} onChange={event => { select(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
    <Button type="button" variant="outline" disabled={disabled} aria-label={label} onClick={() => input.current?.click()}
      className={cn("h-auto min-h-20 w-full flex-col gap-2 whitespace-normal rounded-lg border-dashed px-3 py-4 text-center shadow-none before:shadow-none focus-visible:ring-0", dragging && "border-ring bg-primary/5")}>
      {children ?? <Icon name="Upload" />}
      <span className="w-full break-words text-ui-control">{label}</span>
      {description ? <span className="text-ui-caption text-muted-foreground">{description}</span> : null}
    </Button>
  </div>;
}

export function FileUploadItem({ name, status, statusLabel, error, progress, onRetry, retryLabel, onCancel, cancelLabel, onRemove, removeLabel }:
  { name: string; status: "ready" | "uploading" | "success" | "error"; statusLabel: string; error?: string; progress?: number;
    onRetry?: () => void; retryLabel?: string; onCancel?: () => void; cancelLabel?: string; onRemove?: () => void; removeLabel?: string }) {
  return <div data-slot="file-upload-item" data-status={status} className="min-w-0 space-y-2 rounded-lg bg-muted/40 p-2.5 text-ui-control">
    <div className="flex min-w-0 items-center gap-2">
      <Icon name={status === "uploading" ? "LoaderCircle" : status === "success" ? "CircleCheck" : status === "error" ? "CircleX" : "File"} className={status === "uploading" ? "animate-spin" : undefined} />
      <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
      {onRetry && retryLabel && status === "error" ? <Button type="button" size="sm" variant="ghost" onClick={onRetry}>{retryLabel}</Button> : null}
      {onCancel && cancelLabel && status === "uploading" ? <Button size="sm" variant="ghost" onClick={onCancel}>{cancelLabel}</Button> : null}
      {onRemove && removeLabel && status !== "uploading" ? <Button type="button" size="icon-sm" variant="ghost" aria-label={removeLabel} onClick={onRemove}><Icon name="X" /></Button> : null}
    </div>
    <p role={status === "error" ? "alert" : "status"} className={cn("text-ui-meta", status === "error" ? "text-destructive" : "text-muted-foreground")}>{error || statusLabel}</p>
    {status === "uploading" && progress !== undefined ? <Progress value={progress} aria-label={statusLabel} /> : null}
  </div>;
}

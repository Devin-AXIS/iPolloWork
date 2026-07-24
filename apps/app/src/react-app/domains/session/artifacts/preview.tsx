/** @jsxImportSource react */
import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { MarkdownBlock } from "../surface/markdown";
import {
  htmlPreviewMode,
  SLIDE_PREVIEW_HEIGHT,
  SLIDE_PREVIEW_WIDTH,
  slidePreviewScale,
} from "./html-preview-mode";

interface PreviewLoadingProps extends React.ComponentProps<"div"> {}

export function PreviewLoading({ className, ...props }: PreviewLoadingProps) {
  return (
    <div className={cn("flex h-full items-center justify-center text-muted-foreground", className)} {...props}>
      <Loader2 className="size-4 animate-spin" />
    </div>
  );
}

interface PreviewErrorProps extends React.ComponentProps<"div"> {
  message: string;
}

export function PreviewError({ message, className, ...props }: PreviewErrorProps) {
  return <div className={cn("p-4 text-sm text-muted-foreground", className)} {...props}>{message}</div>;
}

interface PlainTextProps extends React.ComponentProps<"pre"> {
  content: string;
}

export function PlainText({ content, className, ...props }: PlainTextProps) {
  return <pre className={cn("h-full overflow-auto p-4 text-xs leading-5 text-foreground whitespace-pre-wrap", className)} {...props}>{content}</pre>;
}

interface MarkdownPreviewProps extends React.ComponentProps<"div"> {
  content: string;
}

export function MarkdownPreview({ content, className, ...props }: MarkdownPreviewProps) {
  return (
    <div className={cn("h-full overflow-auto p-4", className)} {...props}>
      <MarkdownBlock text={content} />
    </div>
  );
}

interface TextHTMLPreviewProps {
  type: "text";
  title: string;
  content: string;
}

interface BinaryHTMLPreviewProps {
  type: "binary";
  title: string;
  url: string;
}

type HTMLPreviewProps = { className?: string } & (TextHTMLPreviewProps | BinaryHTMLPreviewProps);

export function HTMLPreview({ className, ...props }: HTMLPreviewProps) {
  if (props.type === "text") {
    if (htmlPreviewMode(props.content) === "slides") {
      return <SlideHTMLPreview className={className} title={props.title} content={props.content} />;
    }
    return <iframe srcDoc={props.content} title={props.title} className={cn("h-full w-full border-0", className)} sandbox="allow-scripts allow-same-origin" />;
  }

  return <iframe src={props.url} title={props.title} className={cn("h-full w-full border-0", className)} sandbox="allow-scripts allow-same-origin" />;
}

interface SlideHTMLPreviewProps {
  className?: string;
  title: string;
  content: string;
}

function SlideHTMLPreview({ className, title, content }: SlideHTMLPreviewProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const scale = slidePreviewScale(viewport.width, viewport.height);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = () => {
      const rect = viewport.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("relative h-full min-h-0 overflow-hidden bg-muted/30 p-3", className)}>
      <div ref={viewportRef} className="absolute inset-3">
        <iframe
          srcDoc={content}
          title={title}
          className="absolute left-1/2 top-1/2 origin-center border-0 bg-white shadow-sm"
          style={{
            width: SLIDE_PREVIEW_WIDTH,
            height: SLIDE_PREVIEW_HEIGHT,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}

interface PdfPreviewProps {
  url: string;
  title: string;
  className?: string;
}

export function PdfPreview({ url, title, className }: PdfPreviewProps) {
  // Chromium's built-in PDF viewer (enabled via webPreferences.plugins) renders
  // reliably through <embed>; <object>/sandboxed <iframe> show a blank frame.
  // The blob URL comes from a trusted workspace file.
  return <embed src={url} type="application/pdf" title={title} className={cn("h-full w-full border-0", className)} />;
}

interface ImagePreviewProps extends React.ComponentProps<"div"> {
  src: string;
  alt: string;
}

export function ImagePreview({ src, alt, className, ...props }: ImagePreviewProps) {
  return (
    <div className={cn("flex h-full items-center justify-center overflow-auto bg-muted/30 p-3", className)} {...props}>
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

interface PreviewUnavailableProps extends React.ComponentProps<"div"> {}

export function PreviewUnavailable({ className, ...props }: PreviewUnavailableProps) {
  return <div className={cn("p-4 text-sm text-muted-foreground", className)} {...props}>{t("artifact.preview_unavailable")}</div>;
}

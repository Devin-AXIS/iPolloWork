"use client"

import { CircleAlert, LoaderCircle, SquareTerminalIcon } from "lucide-react"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"
import { getToolActivityLabel } from "@/lib/tool-activity"
import type { BashToolPart } from "@/lib/build-in-tools"

interface BashToolProps {
  part: BashToolPart
}

export function BashTool({ part }: BashToolProps) {
  const isError = part.state === "output-error"
  const isRunning = part.state === "input-streaming" || part.state === "input-available"
  const command = part.input?.command?.trim() || "Command details unavailable"
  const output = part.state === "output-available" ? part.output : null
  const errorText = isError
    ? part.errorText?.trim() || "Command failed or was interrupted before an error was reported."
    : null

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger
          className={isError ? "text-destructive hover:text-destructive" : undefined}
          leftIcon={
            isRunning
              ? <LoaderCircle className="size-4 animate-spin" />
              : isError
                ? <CircleAlert className="size-4" />
                : <SquareTerminalIcon className="size-4" />
          }
        >
          <span className="flex gap-2">
            <span className="shrink-0">
              {getToolActivityLabel(part)}
            </span>
          </span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="bg-muted rounded-lg p-2">
          <div className="flex flex-col gap-2 text-xs">
            <pre className="whitespace-pre-wrap wrap-break-word">$ {command}</pre>
            {output ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word opacity-80">{output}</pre> : null}
            {errorText ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <div className="mb-1 font-medium text-destructive">Command failed or was interrupted</div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word text-destructive">{errorText}</pre>
              </div>
            ) : null}
          </div>
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}

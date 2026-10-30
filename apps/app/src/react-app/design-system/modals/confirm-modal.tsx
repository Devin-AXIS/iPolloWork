/** @jsxImportSource react */
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel: string;
  busy?: boolean;
  children?: ReactNode;
  cancelLabel: string;
  variant?: "danger" | "warning";
  confirmButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  cancelButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal(props: ConfirmModalProps) {
  const variant = props.variant ?? "warning";
  const confirmVariant = props.confirmButtonVariant ?? (variant === "danger" ? "destructive" : undefined);
  const cancelVariant = props.cancelButtonVariant ?? "outline";

  let iconTileClass = "bg-amber-3/50 text-amber-11";
  if (variant === "danger") iconTileClass = "bg-red-3/50 text-red-11";

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className={iconTileClass}>
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {props.children}
        <AlertDialogFooter>
          <AlertDialogCancel variant={cancelVariant} disabled={props.busy}>
            {props.cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            disabled={props.busy}
            onClick={(event) => {
              if (props.busy !== undefined) event.preventDefault();
              props.onConfirm();
            }}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

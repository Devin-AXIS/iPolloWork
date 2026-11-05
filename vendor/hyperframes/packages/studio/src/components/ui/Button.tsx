import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button as SharedButton } from "@ipollowork/ui/controls";
import { Loader2 } from "lucide-react";

// Keep Studio callers and callbacks; presentation belongs to shared UI.
type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";
const variants = { primary: "default", secondary: "outline", danger: "destructive", ghost: "ghost" } satisfies Record<ButtonVariant, "default" | "outline" | "destructive" | "ghost">;
const sizes = { sm: "sm", md: "default", lg: "lg" } satisfies Record<ButtonSize, "sm" | "default" | "lg">;
const iconSizes = { sm: "icon-sm", md: "icon", lg: "icon-lg" } satisfies Record<ButtonSize, "icon-sm" | "icon" | "icon-lg">;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, icon, children, disabled, ...props }, ref) => (
    <SharedButton ref={ref} variant={variants[variant]} size={sizes[size]} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : icon}
      {children}
    </SharedButton>
  ),
);
Button.displayName = "Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  "aria-label": string;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "md", variant = "ghost", ...props }, ref) => (
    <SharedButton ref={ref} variant={variants[variant]} size={iconSizes[size]} {...props}>{icon}</SharedButton>
  ),
);
IconButton.displayName = "IconButton";

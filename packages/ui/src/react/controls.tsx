import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { type VariantProps } from "class-variance-authority"
import { createContext, useContext, type ReactNode } from "react"

import { cn, buttonVariants, settingsButtonVariants, inputClassName, textareaClassName } from "../common/control-styles"
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

type ButtonStyleScope = "default" | "settings"

const ButtonStyleScopeContext = createContext<ButtonStyleScope>("default")

function ButtonStyleScopeProvider({
  value,
  children,
}: {
  value: ButtonStyleScope
  children: ReactNode
}) {
  return <ButtonStyleScopeContext.Provider value={value}>{children}</ButtonStyleScopeContext.Provider>
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const styleScope = useContext(ButtonStyleScopeContext)

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size }),
        styleScope === "settings" ? settingsButtonVariants({ variant, size }) : null,
        className,
      )}
      {...props}
    />
  )
}

export { Button, ButtonStyleScopeProvider, buttonVariants }
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        inputClassName,
        className
      )}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        textareaClassName,
        className
      )}
      {...props}
    />
  )
}


export {Input, Textarea}

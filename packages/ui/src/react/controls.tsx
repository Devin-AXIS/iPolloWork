import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { type VariantProps } from "class-variance-authority"
import { createContext, useContext, type ReactNode } from "react"

import { cn, buttonVariants, settingsButtonVariants, inputClassName, textareaClassName } from "../common/control-styles"
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

type ButtonStyleScope = "default" | "settings"

const ButtonStyleScopeContext = createContext<{ value: ButtonStyleScope; flat: boolean }>({ value: "default", flat: false })

function ButtonStyleScopeProvider({
  value,
  flat = false,
  children,
}: {
  value: ButtonStyleScope
  flat?: boolean
  children: ReactNode
}) {
  return <ButtonStyleScopeContext.Provider value={{ value, flat }}>{children}</ButtonStyleScopeContext.Provider>
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
        styleScope.value === "settings" ? settingsButtonVariants({ variant, size }) : null,
        styleScope.flat ? "shadow-none before:shadow-none dark:before:shadow-none" : null,
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

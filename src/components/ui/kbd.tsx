import * as React from "react"

import { cn } from "@/lib/utils"

/** A small keyboard-key pill (matches the Tooltip's `data-slot=kbd` styling hook). */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border border-b-2 bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }

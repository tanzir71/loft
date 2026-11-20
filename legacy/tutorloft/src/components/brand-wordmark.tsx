import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export function BrandWordmark({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn("font-display italic tracking-normal text-foreground", className)}
      {...props}
    >
      Tutor<span className="text-primary">Loft</span>
    </span>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-md border border-line bg-raised px-3 py-2.5 text-sm text-fg placeholder:text-subtle outline-none transition-[box-shadow] duration-[var(--motion-quick)] focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

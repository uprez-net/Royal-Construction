"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Copy a value to the clipboard, with a moment of "Copied" to confirm it.
 * Says so when the browser refuses (an insecure origin, a denied permission)
 * rather than pretending it worked.
 */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  successToast,
  className,
  variant = "outline",
  size = "sm",
  iconOnly = false,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  successToast?: string;
  className?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default" | "icon";
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (successToast) toast.success(successToast);
    } catch {
      toast.error("Couldn't copy — select the text and copy it instead.");
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon" : size}
      onClick={() => void copy()}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
      className={cn(iconOnly && "size-8", className)}
    >
      <Icon
        className={cn(
          "size-3.5",
          !iconOnly && "mr-1.5",
          copied && "text-emerald-600",
        )}
        aria-hidden="true"
      />
      {iconOnly ? null : copied ? copiedLabel : label}
    </Button>
  );
}

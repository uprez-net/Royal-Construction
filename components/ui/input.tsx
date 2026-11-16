"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAiRewrite, type AiRewriteError } from "@/hooks/useAiWrite";
import type { AiAction } from "@/lib/ai-rewrite/schema";
// ^ adjust these three import paths to match your project structure

const AI_REWRITE_LABELS: Record<AiAction, string> = {
  "fix-grammar": "Fix grammar",
  improve: "Improve",
  shorten: "Shorten",
};

const DEFAULT_AI_REWRITE_ACTIONS: AiAction[] = [
  "improve",
  "fix-grammar",
  "shorten",
];

export type AiRewriteConfig = {
  /** Which actions to offer, in menu order. Defaults to all three. */
  actions?: AiAction[];
  onError?: (error: AiRewriteError) => void;
};

export type InputProps = React.ComponentProps<"input"> & {
  /**
   * Enables an inline AI-rewrite button. Pass `true` for the defaults, or
   * an object to pick specific actions / handle errors.
   *
   * When enabled, the input is wrapped in a positioning container:
   * `className` sizes that wrapper (so `w-64`, `flex-1`, etc. keep
   * working) and `inputClassName` targets the `<input>` surface itself.
   */
  aiRewrite?: boolean | AiRewriteConfig;
  inputClassName?: string;
};

/**
 * Sets an <input>'s value through React's native setter so any onChange
 * handler attached to it (controlled state, react-hook-form, etc.) fires
 * correctly. A plain `input.value = x` assignment is invisible to React's
 * controlled-input change tracking.
 */
function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function AiRewriteTrigger({
  inputRef,
  config,
  disabled,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  config: AiRewriteConfig;
  disabled?: boolean;
}) {
  const actions = config.actions?.length
    ? config.actions
    : DEFAULT_AI_REWRITE_ACTIONS;
  const {
    rewrite,
    isLoading,
    action: activeAction,
  } = useAiRewrite({
    onError: config.onError,
  });

  const handleSelect = async (nextAction: AiAction) => {
    const input = inputRef.current;
    if (!input) return;
    const before = input.value;
    if (!before.trim()) return;

    const result = await rewrite(before, nextAction);
    // Skip applying the result if the field was edited while the request
    // was in flight, so we never clobber the user's own typing.
    if (result && inputRef.current && inputRef.current.value === before) {
      setNativeInputValue(inputRef.current, result);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || isLoading}
          aria-label="Rewrite with AI"
          aria-busy={isLoading}
          className="absolute right-0.5 top-0.5 size-7 text-muted-foreground hover:text-foreground"
        >
          {isLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a}
            disabled={isLoading}
            onSelect={() => handleSelect(a)}
          >
            {isLoading && activeAction === a && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {AI_REWRITE_LABELS[a]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Input({
  className,
  inputClassName,
  type,
  aiRewrite,
  ref,
  ...props
}: InputProps) {
  const internalRef = React.useRef<HTMLInputElement>(null);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      internalRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref)
        (ref as React.RefObject<HTMLInputElement | null>).current = node;
    },
    [ref],
  );

  const config: AiRewriteConfig | null = !aiRewrite
    ? null
    : aiRewrite === true
      ? {}
      : aiRewrite;

  const baseInputClassName =
    "h-[2.125rem] w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-base transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm";

  if (!config) {
    return (
      <input
        type={type}
        data-slot="input"
        ref={setRefs}
        className={cn(baseInputClassName, className)}
        {...props}
      />
    );
  }

  return (
    <div className={cn("relative", className)}>
      <input
        type={type}
        data-slot="input"
        ref={setRefs}
        className={cn(baseInputClassName, "pr-8", inputClassName)}
        {...props}
      />
      <AiRewriteTrigger
        inputRef={internalRef}
        config={config}
        disabled={props.disabled}
      />
    </div>
  );
}

export { Input };

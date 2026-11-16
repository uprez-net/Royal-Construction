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

export type TextareaProps = React.ComponentProps<"textarea"> & {
  /**
   * Enables an inline AI-rewrite button. Pass `true` for the defaults, or
   * an object to pick specific actions / handle errors.
   *
   * When enabled, the textarea is wrapped in a positioning container:
   * `className` sizes that wrapper (so `w-full`, `flex-1`, etc. keep
   * working) and `textareaClassName` targets the `<textarea>` surface
   * itself.
   */
  aiRewrite?: boolean | AiRewriteConfig;
  textareaClassName?: string;
};

/**
 * Sets a <textarea>'s value through React's native setter so any onChange
 * handler attached to it (controlled state, react-hook-form, etc.) fires
 * correctly. A plain `textarea.value = x` assignment is invisible to
 * React's controlled-input change tracking.
 */
function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function AiRewriteTrigger({
  textareaRef,
  config,
  disabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
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
    const textarea = textareaRef.current;
    if (!textarea) return;
    const before = textarea.value;
    if (!before.trim()) return;

    const result = await rewrite(before, nextAction);
    // Skip applying the result if the field was edited while the request
    // was in flight, so we never clobber the user's own typing.
    if (result && textareaRef.current && textareaRef.current.value === before) {
      setNativeTextareaValue(textareaRef.current, result);
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
          className="absolute right-1 top-1 size-7 text-muted-foreground hover:text-foreground"
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

function Textarea({
  className,
  textareaClassName,
  aiRewrite,
  ref,
  ...props
}: TextareaProps) {
  const internalRef = React.useRef<HTMLTextAreaElement>(null);

  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref)
        (ref as React.RefObject<HTMLTextAreaElement | null>).current = node;
    },
    [ref],
  );

  const config: AiRewriteConfig | null = !aiRewrite
    ? null
    : aiRewrite === true
      ? {}
      : aiRewrite;

  const baseTextareaClassName =
    "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card px-2.5 py-2 text-base transition-colors placeholder:text-muted-foreground selection:bg-transparent selection:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm";

  if (!config) {
    return (
      <textarea
        data-slot="textarea"
        ref={setRefs}
        className={cn(baseTextareaClassName, className)}
        {...props}
      />
    );
  }

  return (
    <div className={cn("relative", className)}>
      <textarea
        data-slot="textarea"
        ref={setRefs}
        className={cn(baseTextareaClassName, "pr-9", textareaClassName)}
        {...props}
      />
      <AiRewriteTrigger
        textareaRef={internalRef}
        config={config}
        disabled={props.disabled}
      />
    </div>
  );
}

export { Textarea };

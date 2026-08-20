"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_ACTIONS,
  type AiAction,
  type AiRewriteErrorResponse,
  type AiRewriteResponse,
} from "@/lib/ai-rewrite/schema";
// ^ adjust this path to match wherever you place schema.ts

const AI_ENDPOINT = "/api/ai";

export class AiRewriteError extends Error {
  status: number;
  details?: AiRewriteErrorResponse["details"];

  constructor(message: string, status: number, details?: AiRewriteErrorResponse["details"]) {
    super(message);
    this.name = "AiRewriteError";
    this.status = status;
    this.details = details;
  }
}

interface UseAiRewriteOptions {
  onSuccess?: (text: string, action: AiAction) => void;
  onError?: (error: AiRewriteError) => void;
}

interface UseAiRewriteResult {
  /** Calls /api/ai. Returns the rewritten text, or null on failure/cancel. */
  rewrite: (text: string, action: AiAction) => Promise<string | null>;
  isLoading: boolean;
  error: AiRewriteError | null;
  /** The action currently in flight (or most recently run). */
  action: AiAction | null;
  reset: () => void;
  cancel: () => void;
}

export function useAiRewrite(options: UseAiRewriteOptions = {}): UseAiRewriteResult {
  const { onSuccess, onError } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AiRewriteError | null>(null);
  const [action, setAction] = useState<AiAction | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (isMountedRef.current) setIsLoading(false);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setError(null);
    setAction(null);
  }, [cancel]);

  const rewrite = useCallback(
    async (text: string, nextAction: AiAction): Promise<string | null> => {
      const trimmed = text.trim();

      if (!AI_ACTIONS.includes(nextAction)) {
        const err = new AiRewriteError("Unknown AI action.", 400);
        setError(err);
        onError?.(err);
        return null;
      }
      if (!trimmed) {
        const err = new AiRewriteError("Note text is required.", 400);
        setError(err);
        onError?.(err);
        return null;
      }

      // Cancel any request already in flight so a slow, stale response
      // can never overwrite the result of a newer one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);
      setAction(nextAction);

      try {
        const res = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: nextAction, text: trimmed }),
          signal: controller.signal,
        });

        const data: AiRewriteResponse | AiRewriteErrorResponse | null = await res
          .json()
          .catch(() => null);

        if (!res.ok) {
          const errData = data as AiRewriteErrorResponse | null;
          throw new AiRewriteError(
            errData?.error ?? "Failed to rewrite the note.",
            res.status,
            errData?.details,
          );
        }

        const rewritten = (data as AiRewriteResponse | null)?.text;
        if (!rewritten) {
          throw new AiRewriteError("AI returned an empty response.", 502);
        }

        onSuccess?.(rewritten, nextAction);
        return rewritten;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Superseded by a newer call or explicitly cancelled — not a
          // user-facing error, so don't surface it.
          return null;
        }

        const aiError =
          err instanceof AiRewriteError
            ? err
            : new AiRewriteError(
                err instanceof Error ? err.message : "Failed to rewrite the note.",
                0,
              );

        if (isMountedRef.current) setError(aiError);
        onError?.(aiError);
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (isMountedRef.current) setIsLoading(false);
      }
    },
    [onError, onSuccess],
  );

  return { rewrite, isLoading, error, action, reset, cancel };
}
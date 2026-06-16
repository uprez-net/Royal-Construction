"use client";

import { OfferCreationStatus } from "@/lib/workflow/offer";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * ------------------------------------------------------------
 * TYPES
 * ------------------------------------------------------------
 */

type WorkflowStreamState = {
  runId: string | null;
  connected: boolean;
  loading: boolean;
  error: string | null;

  creatingOffer: OfferCreationStatus;

  startListening: (runId: string) => void;
  stopListening: () => void;
  reset: () => void;
};

const WorkflowStreamContext = createContext<WorkflowStreamState | null>(null);

/**
 * ------------------------------------------------------------
 * DEFAULTS
 * ------------------------------------------------------------
 */

const defaultCreatingOffer: OfferCreationStatus = {
  status: "FETCHING_DETAILS",
  progress: 0,
  message: [
    {
      step: "FETCHING_DETAILS",
      details: "Starting offer creation workflow",
    },
  ],
};

/**
 * ------------------------------------------------------------
 * WORKFLOW STREAM PROVIDER
 * ------------------------------------------------------------
 *
 * Manages connection to a workflow stream, including file processing and report generation steps.
 * Provides real-time updates on processing status and handles automatic chaining between steps.
 * Designed to be used in the project details page to show live progress of report generation.
 * ------------------------------------------------------------
 */

export function WorkflowStreamProvider({
  initialRunId = null,
  children,
}: {
  initialRunId: string | null;
  children: React.ReactNode;
}) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creatingOffer, setCreatingOffer] =
    useState<OfferCreationStatus | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const startIndexRef = useRef(0);

  /**
   * ------------------------------------------------------------
   * RESET
   * ------------------------------------------------------------
   */

  const reset = useCallback(() => {
    setConnected(false);
    setLoading(false);
    setError(null);
    setRunId(null);
    setCreatingOffer(null);
    startIndexRef.current = 0;

    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /**
   * ------------------------------------------------------------
   * STOP
   * ------------------------------------------------------------
   */

  const stopListening = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setConnected(false);
    setLoading(false);
  }, []);

  /**
   * ------------------------------------------------------------
   * STREAM READER
   * ------------------------------------------------------------
   */

  const connectToRun = useCallback(async (id: string) => {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setRunId(id);
    setLoading(true);
    setError(null);
    setCreatingOffer(defaultCreatingOffer);

    try {
      const res = await fetch(
        `/api/resume-stream/${id}?startIndex=${startIndexRef.current}`,
        {
          method: "GET",
          signal: controller.signal,
        },
      );

      if (!res.ok || !res.body) {
        throw new Error("Unable to connect to workflow stream.");
      }

      setConnected(true);
      setLoading(false);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        console.log("Got chunk:", buffer);

        /**
         * assumes each chunk is newline-delimited json
         */
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";

        for (const line of parts) {
          if (!line.trim()) continue;

          startIndexRef.current += 1;

          try {
            const payload = JSON.parse(line);
            console.log(payload);
            setCreatingOffer(payload);
          } catch {
            console.error("Invalid stream payload:", line);
          }
        }
      }

      setConnected(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Stream connection failed.";
      if (error instanceof DOMException && error.name === "AbortError") return;

      setError(message);
      setConnected(false);
      setLoading(false);
    }
  }, []);

  /**
   * ------------------------------------------------------------
   * PUBLIC START
   * ------------------------------------------------------------
   */

  const startListening = useCallback(
    (id: string) => {
      connectToRun(id);
    },
    [connectToRun],
  );

  /**
   * ------------------------------------------------------------
   * CLEANUP & INITIALIZATION
   * ------------------------------------------------------------
   * If initialRunId is provided, connect on mount. Clean up on unmount.
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (initialRunId) {
      queueMicrotask(() => {
        connectToRun(initialRunId);
      });
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [initialRunId, connectToRun]);

  useEffect(() => {
    if (!runId || !connected) return;

    const interval = setInterval(
      () => {
        console.log("Refreshing SSE connection...");
        void connectToRun(runId);
      },
      2 * 60 * 1000,
    ); // 2 minutes

    return () => clearInterval(interval);
  }, [runId, connected, connectToRun]);

  const value = useMemo(
    () => ({
      runId,
      connected,
      loading,
      error,
      creatingOffer: creatingOffer ?? defaultCreatingOffer,
      startListening,
      stopListening,
      reset,
    }),
    [
      runId,
      connected,
      loading,
      error,
      creatingOffer,
      startListening,
      stopListening,
      reset,
    ],
  );

  return (
    <WorkflowStreamContext.Provider value={value}>
      {children}
    </WorkflowStreamContext.Provider>
  );
}

/**
 * ------------------------------------------------------------
 * HOOK
 * ------------------------------------------------------------
 */

export function useWorkflowStream() {
  const context = useContext(WorkflowStreamContext);

  if (!context) {
    throw new Error(
      "useWorkflowStream must be used inside WorkflowStreamProvider",
    );
  }

  return context;
}

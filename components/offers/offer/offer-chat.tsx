"use client";

import { useChatContext } from "@/context/ChatContext";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bot, SendHorizonalIcon, SparklesIcon, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Response } from "@/components/chat/response";
import remarkGfm from "remark-gfm";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ToolResult } from "@/components/chat/tool-result";
import { ReasoningResponse } from "@/components/chat/reasoning-response";
import { v4 as generateUUID } from "uuid";
import type { ToolType } from "@/types/chat";

export function OfferChat() {
  const { messages, sendMessage, setMessages, status, error, stop } =
    useChatContext();
  const [input, setInput] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useEffectEvent((behavior: ScrollBehavior = "auto") => {
    viewportRef.current?.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior,
    });
  });

  const handleScroll = useEffectEvent(() => {
    const el = viewportRef.current;
    if (!el) return;

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;

    setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    el.addEventListener("scroll", handleScroll);

    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useLayoutEffect(() => {
    if (isAtBottom) {
      scrollToBottom("auto");
    }
  }, [messages, isAtBottom]);

  const handleSendMessage = () => {
    const text = input.trim();
    if (!text) return;

    if (messages.length === 1 && messages.at(-1)?.role !== "user") {
      setMessages([]);
    }

    sendMessage({
      id: generateUUID(),
      parts: [{ type: "text", text }],
      metadata: {
        createdAt: new Date().toISOString(),
      },
    });
    setInput("");
  };

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden",
        "bg-card",
      )}
    >
      <div className="shrink-0 border-b border-border/70 bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl border border-royal-gold/20 bg-royal-gold-light font-semibold text-foreground shadow-sm">
            RC
          </div>
          <span className="font-heading text-xl font-semibold tracking-tight text-foreground">
            OfferGPT
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          className="h-full min-h-0 overflow-y-auto px-4 py-3 no-scrollbar"
        >
          <div
            className="flex flex-col gap-4 pb-3"
          >
            {messages.map((msg) => {
              const visibleParts = msg.parts.filter(
                (part) =>
                  (part.type === "text" && part.text.trim().length > 0) ||
                  part.type === "reasoning" ||
                  part.type.startsWith("tool-"),
              );
              const hasText = visibleParts.some(
                (part) => part.type === "text" && part.text.trim().length > 0,
              );
              const isToolOnly =
                !hasText && visibleParts.some((part) => part.type.startsWith("tool-"));

              if (visibleParts.length === 0) return null;

              if (isToolOnly) {
                return (
                  <div key={msg.id} className="ml-10 max-w-[88%]">
                    <div className="space-y-1.5">
                      {visibleParts.map((part, i) =>
                        part.type.startsWith("tool-") ? (
                          <ToolResult key={`tool-part-${i}`} part={part as ToolType} />
                        ) : part.type === "reasoning" ? (
                          <ReasoningResponse key={`reasoning-${i}`} part={part} />
                        ) : null,
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {msg.role !== "user" && (
                    <Avatar className="mt-0.5 h-8 w-8 border border-royal-gold/20 bg-royal-gold-light">
                      <AvatarFallback className="bg-royal-gold text-primary-foreground">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed shadow-sm",
                      msg.role === "user"
                        ? "border border-royal-gold/20 bg-royal-gold-light text-foreground"
                        : "border border-border/70 bg-card text-foreground",
                    )}
                  >
                    {visibleParts.map((part, i) =>
                      part.type === "text" ? (
                        <div key={i} className="m-0 w-full p-0">
                          <Response
                            controls={{ table: true }}
                            remarkPlugins={[remarkGfm]}
                          >
                            {part.text}
                          </Response>
                        </div>
                      ) : part.type.startsWith("tool-") ? (
                        <div className="my-1.5" key={`tool-part-${i}`}>
                          <ToolResult part={part as ToolType} />
                        </div>
                      ) : part.type === "reasoning" ? (
                        <ReasoningResponse key={`reasoning-${i}`} part={part} />
                      ) : null,
                    )}
                  </div>
                </div>
              );
            })}
            {status === "streaming" && <ThinkingMessage />}
            {error && (
              <div className="max-w-[85%] self-center rounded-lg border border-destructive/20 bg-destructive-light px-3 py-2 text-sm leading-relaxed text-destructive shadow-sm">
                {error.message ||
                  "An error occurred while processing your chat."}
              </div>
            )}
          </div>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="shrink-0 border-t border-border/70 bg-card px-4 py-3"
      >
        <div className="relative">
          <Textarea
            disabled={status === "streaming" || status === "submitted"}
            value={input}
            rows={1}
            placeholder="Ask about properties, data, or insights…"
            onChange={(e) => {
              setInput(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(
                e.currentTarget.scrollHeight,
                160,
              )}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            className="resize-none rounded-lg border border-border bg-background pr-12 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-royal-gold/20"
          />
          {status === "streaming" || status === "submitted" ? (
            <Button
              type="button"
              size="icon"
              onClick={() => stop()}
              className={cn(
                "absolute right-2 bottom-2 h-8 w-8 rounded-full shadow-sm",
                "bg-destructive text-primary-foreground hover:bg-destructive/90",
              )}
            >
              <span className="sr-only">Stop</span>
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              className={cn(
                "absolute right-2 bottom-2 h-8 w-8 rounded-full shadow-sm",
                input.trim()
                  ? "bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
                  : "bg-royal-gold-light text-foreground",
              )}
            >
              <SendHorizonalIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-royal-gold/20 bg-royal-gold-light text-foreground ring-1 ring-card/70">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-sm text-muted-foreground">
            <span className="animate-pulse">Thinking</span>
            <span className="inline-flex">
              <span className="animate-bounce [animation-delay:0ms]">.</span>
              <span className="animate-bounce [animation-delay:150ms]">.</span>
              <span className="animate-bounce [animation-delay:300ms]">.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

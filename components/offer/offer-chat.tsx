"use client";

import { useChatContext } from "@/context/ChatContext";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { Bot, SendHorizonalIcon, SparklesIcon } from "lucide-react";
import { Textarea } from "../ui/textarea";
import { ScrollArea } from "../ui/scroll-area";
import { Response } from "../chat/response";
import remarkGfm from "remark-gfm";
import { ToolResult } from "../chat/tool-result";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function OfferChat() {
  const { messages, sendMessage, status, error } = useChatContext();
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
  }, [messages]);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-20 w-[40vw] min-w-[320px] max-w-150",
        "bg-[#1a1f26]/95 backdrop-blur-xl border-r border-white/10",
        "transition-transform duration-300 ease-in-out flex flex-col",
        "translate-x-0",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-[#242b33]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#0d7377] to-[#095456] flex items-center justify-center font-serif font-bold text-lg text-white">
            RC
          </div>
          <span className="font-serif text-xl font-semibold text-[#f7f9fc]">
            RealEstateGPT
          </span>
        </div>
      </div>
      {/* Chat messages */}
      <div className="flex-1 min-h-0">
        <ScrollArea
          className="h-full px-4 py-3 overflow-hidden"
          ref={viewportRef}
        >
          <div className="flex flex-col gap-4">
            {messages.map(
              (msg) =>
                msg.parts.some(
                  (part) => part.type === "text" && part.text.trim().length > 0,
                ) && (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex gap-2",
                      msg.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {/* Agent Avatar */}
                    {msg.role !== "user" && (
                      <Avatar className="h-8 w-8 mt-0.5 border border-[#0d7377] bg-[#242b33]">
                        <AvatarFallback className="bg-[#0d7377] text-white">
                          <Bot className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    {/* Message Bubble */}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-[#0d7377]/20 text-[#f7f9fc]"
                          : "bg-[#242b33] text-[#f7f9fc] border border-[#0d7377]/30",
                      )}
                    >
                      {msg.parts.map((part, i) =>
                        part.type === "text" ? (
                          <div key={i} className="m-0 p-0 w-full">
                            <Response
                              controls={{ table: true }}
                              remarkPlugins={[remarkGfm]}
                            >
                              {part.text}
                            </Response>
                          </div>
                        ) : part.type.startsWith("tool-") ? (
                          <div className="my-2" key={`tool-part-${i}`}>
                            <ToolResult part={part} />
                          </div>
                        ) : null,
                      )}
                    </div>
                  </div>
                ),
            )}
            {status === "streaming" && <ThinkingMessage />}
            {error && (
              <div className="max-w-[85%] rounded-lg bg-red-100/70 text-red-900 self-center px-3 py-2 text-sm leading-relaxed">
                {error.message ||
                  "An error occurred while processing your chat."}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ parts: [{ type: "text", text: input }] });
          setInput("");
        }}
        className="border-t border-white/10 px-4 py-3 bg-[#242b33]"
      >
        <div className="relative">
          <Textarea
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
                if (input.trim()) {
                  sendMessage({
                    parts: [{ type: "text", text: input }],
                  });
                  setInput("");
                }
              }
            }}
            className="resize-none pr-12 rounded-lg border border-white/10 bg-[#1a1f26]/80 text-sm focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="icon"
            disabled={
              !input.trim() || status === "streaming" || status === "submitted"
            }
            className={cn(
              "absolute right-2 bottom-2 h-8 w-8 rounded-full",
              input.trim()
                ? "bg-linear-to-br from-[#0d7377] to-[#095456] text-white"
                : "bg-[#0d7377]/40 text-[#0d7377]",
            )}
          >
            <SendHorizonalIcon className="h-4 w-4" />
          </Button>
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
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#242b33] ring-1 ring-white/10">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-white/60 text-sm">
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

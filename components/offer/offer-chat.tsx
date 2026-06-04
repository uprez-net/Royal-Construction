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
  }, [messages, isAtBottom]);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden",
        "bg-[#1a1f26]/95 backdrop-blur-xl",
      )}
    >
      <div className="shrink-0 border-b border-white/10 bg-[#242b33] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-[#0d7377] to-[#095456] font-serif text-lg font-bold text-white">
            RC
          </div>
          <span className="font-serif text-xl font-semibold text-[#f7f9fc]">
            RealEstateGPT
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          className="h-full min-h-0 overflow-y-auto px-4 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex flex-col gap-4 pb-3">
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
                    {msg.role !== "user" && (
                      <Avatar className="mt-0.5 h-8 w-8 border border-[#0d7377] bg-[#242b33]">
                        <AvatarFallback className="bg-[#0d7377] text-white">
                          <Bot className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-[#0d7377]/20 text-[#f7f9fc]"
                          : "border border-[#0d7377]/30 bg-[#242b33] text-[#f7f9fc]",
                      )}
                    >
                      {msg.parts.map((part, i) =>
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
              <div className="max-w-[85%] self-center rounded-lg bg-red-100/70 px-3 py-2 text-sm leading-relaxed text-red-900">
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
          if (!input.trim()) return;
          sendMessage({ parts: [{ type: "text", text: input }] });
          setInput("");
        }}
        className="shrink-0 border-t border-white/10 bg-[#242b33] px-4 py-3"
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
            className="resize-none pr-12 rounded-lg border border-white/10 bg-[#1a1f26]/80 text-white  text-sm focus-visible:ring-0"
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

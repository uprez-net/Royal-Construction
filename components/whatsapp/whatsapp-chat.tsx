"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  SendHorizontal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { WhatsAppMediaRecord } from "@/lib/domain/whatsapp/media";
import type { Jsonified } from "@/lib/leads/whatsapp-types";
import {
  chatDayKey,
  chatDayLabel,
  chatTime,
  initials,
  senderColour,
} from "@/lib/whatsapp/chat-format";

import { WhatsAppMedia } from "./whatsapp-media";

// A chat that looks and reads like WhatsApp in its light theme, so a
// conversation in the app feels like the one on the business phone: the
// beige wallpaper, green outgoing and white incoming bubbles with tails,
// ticks, day separators, and a rounded composer bar.
//
// Presentation only. The lead conversation and the project group each map
// their own records onto `ChatMessage` and own every rule about sending.
//
// Every body is rendered as text, never HTML: an inbound message is whatever
// a member of the public typed.

export const WA = {
  accent: "#00a884",
  bubbleIn: "#ffffff",
  bubbleOut: "#d9fdd3",
  icon: "#54656f",
  panel: "#f0f2f5",
  read: "#53bdeb",
  text: "#111b21",
  textMuted: "#667781",
  wallpaper: "#efeae2",
} as const;

export type ChatMedia = Jsonified<WhatsAppMediaRecord>;

export type ChatMessage = {
  readonly id: string;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly kind: "TEXT" | "TEMPLATE" | "UNSUPPORTED" | "MEDIA";
  readonly body: string;
  readonly occurredAt: string;
  readonly status:
    | "QUEUED"
    | "SENT"
    | "DELIVERED"
    | "READ"
    | "FAILED"
    | "RECEIVED";
  readonly needsReconciliation: boolean;
  readonly providerErrorTitle: string | null;
  readonly templateName?: string | null;
  /** Inbound in a group: who wrote it. */
  readonly senderName?: string | null;
  /** Stable key for the sender's name colour (their number). */
  readonly senderKey?: string | null;
  /** Outbound: the member of staff who sent it. */
  readonly authorName?: string | null;
  readonly media: ChatMedia | null;
};

/** The whole chat: header, wallpapered message area, composer. */
export function WhatsAppChatFrame({
  header,
  children,
  footer,
  className,
}: {
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-white",
        className,
      )}
      style={{ color: WA.text }}
    >
      {header}
      <div
        className="relative min-h-0 flex-1"
        style={{
          backgroundColor: WA.wallpaper,
          // A faint dotted texture in the spirit of WhatsApp's wallpaper,
          // drawn here rather than copied from it.
          backgroundImage:
            "radial-gradient(rgba(84,101,111,0.07) 1px, transparent 1.2px), radial-gradient(rgba(84,101,111,0.05) 1px, transparent 1.2px)",
          backgroundPosition: "0 0, 11px 11px",
          backgroundSize: "22px 22px",
        }}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

export function ChatAvatar({
  name,
  icon,
  className,
}: {
  name?: string | null;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-semibold text-[#54656f]",
        className,
      )}
    >
      {icon ?? initials(name)}
    </span>
  );
}

export function WhatsAppChatHeader({
  avatar,
  title,
  subtitle,
  actions,
}: {
  avatar: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-[60px] shrink-0 items-center gap-3 border-b border-black/5 px-4 py-2"
      style={{ backgroundColor: WA.panel }}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[15.5px] font-medium leading-5"
          style={{ color: WA.text }}
        >
          {title}
        </p>
        {subtitle ? (
          <p
            className="truncate text-[13px] leading-5"
            style={{ color: WA.textMuted }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex shrink-0 items-center gap-1"
          style={{ color: WA.icon }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function Ticks({ message }: { message: ChatMessage }) {
  if (message.direction !== "OUTBOUND") return null;
  if (message.needsReconciliation || message.status === "FAILED") {
    return (
      <AlertTriangle
        className="size-3.5 text-[#ea0038]"
        aria-label={message.needsReconciliation ? "Unconfirmed" : "Not sent"}
      />
    );
  }
  switch (message.status) {
    case "QUEUED":
      return <Clock className="size-3" aria-label="Sending" />;
    case "SENT":
      return <Check className="size-4" aria-label="Sent" />;
    case "DELIVERED":
      return <CheckCheck className="size-4" aria-label="Delivered" />;
    case "READ":
      return (
        <CheckCheck
          className="size-4"
          style={{ color: WA.read }}
          aria-label="Read"
        />
      );
    default:
      return null;
  }
}

/** The little hook on the first bubble of a run, as WhatsApp draws it. */
function Tail({ outbound }: { outbound: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 13"
      className={cn(
        "absolute top-0 h-[13px] w-2",
        outbound ? "-right-2" : "-left-2 -scale-x-100",
      )}
    >
      <path
        d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z"
        fill={outbound ? WA.bubbleOut : WA.bubbleIn}
      />
    </svg>
  );
}

function Bubble({
  message,
  firstOfRun,
  showSender,
  onRetryMedia,
  actions,
}: {
  message: ChatMessage;
  firstOfRun: boolean;
  showSender: boolean;
  onRetryMedia?: (mediaId: string) => void;
  actions?: ReactNode;
}) {
  const outbound = message.direction === "OUTBOUND";
  const media = message.media;
  const sticker = media?.type === "STICKER" && Boolean(media.url);
  // A caption-less file shows no text: its stored label ("Photo",
  // "Document · plans.pdf") is for Eve and search, and the file says it.
  const showBody = !media || Boolean(media.caption?.trim());
  const time = (
    <span
      className="ml-2 inline-flex translate-y-1 items-center gap-1 whitespace-nowrap align-bottom text-[11px] leading-none"
      style={{ color: WA.textMuted }}
    >
      <time dateTime={message.occurredAt}>{chatTime(message.occurredAt)}</time>
      <Ticks message={message} />
    </span>
  );

  if (sticker && media) {
    return (
      <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
        <div className="flex flex-col items-end gap-0.5">
          <WhatsAppMedia media={media} onRetry={onRetryMedia} />
          <span className="rounded-full bg-black/5 px-1.5 py-0.5">{time}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex",
        outbound ? "justify-end" : "justify-start",
        firstOfRun ? "mt-2" : "mt-0.5",
      )}
    >
      <article
        aria-label={`${outbound ? "Sent" : `From ${message.senderName ?? "them"}`} at ${chatTime(message.occurredAt)}`}
        className={cn(
          "relative max-w-[85%] rounded-lg px-2 pb-1.5 pt-1.5 text-[14.2px] leading-[19px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] sm:max-w-[65%]",
          firstOfRun && (outbound ? "rounded-tr-none" : "rounded-tl-none"),
        )}
        style={{ backgroundColor: outbound ? WA.bubbleOut : WA.bubbleIn }}
      >
        {firstOfRun ? <Tail outbound={outbound} /> : null}
        {showSender && !outbound && firstOfRun ? (
          <p
            className="mb-0.5 truncate text-[12.8px] font-medium"
            style={{ color: senderColour(message.senderKey) }}
          >
            {message.senderName ?? message.senderKey ?? "Unknown"}
          </p>
        ) : null}
        {outbound && message.authorName && firstOfRun ? (
          <p className="mb-0.5 text-[12px] font-medium text-[#008069]">
            {message.authorName}
          </p>
        ) : null}
        {message.kind === "TEMPLATE" ? (
          <p
            className="mb-1 text-[11px] font-medium uppercase tracking-wide"
            style={{ color: WA.textMuted }}
          >
            Template · {message.templateName}
          </p>
        ) : null}
        {media ? (
          <div className="mb-1 -mx-1 -mt-0.5">
            <WhatsAppMedia media={media} onRetry={onRetryMedia} />
          </div>
        ) : null}
        {showBody ? (
          <p
            className={cn(
              "whitespace-pre-wrap break-words",
              message.kind === "UNSUPPORTED" && "italic",
            )}
            style={
              message.kind === "UNSUPPORTED"
                ? { color: WA.textMuted }
                : undefined
            }
          >
            {message.body}
            {time}
          </p>
        ) : (
          <p className="flex justify-end">{time}</p>
        )}
        {message.providerErrorTitle
        && (message.status === "FAILED" || message.needsReconciliation) ? (
          <p className="mt-1 text-[12px] text-[#ea0038]">
            {message.providerErrorTitle}
          </p>
        ) : null}
        {actions}
      </article>
    </div>
  );
}

/**
 * The scrolling message area. Opens at the newest message, stays pinned to the
 * bottom while new ones arrive if you were already there, and keeps your place
 * when older ones load above.
 */
export function WhatsAppMessageList({
  messages,
  showSenders = false,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  onRetryMedia,
  renderActions,
  empty,
  banner,
}: {
  messages: readonly ChatMessage[];
  /** Group chats name who wrote each incoming run. */
  showSenders?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  onRetryMedia?: (mediaId: string) => void;
  /** Extra controls under a bubble (reconcile buttons). */
  renderActions?: (message: ChatMessage) => ReactNode;
  empty?: ReactNode;
  /** A pinned notice above the first message (encryption-style chip). */
  banner?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const firstId = messages[0]?.id;
  const lastId = messages.at(-1)?.id;
  const previousHeight = useRef(0);
  const previousFirst = useRef<string | undefined>(undefined);
  const [now] = useState(() => new Date());

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (
      previousFirst.current
      && firstId !== previousFirst.current
      && !pinned.current
    ) {
      // Older messages were prepended: hold the reader's place.
      element.scrollTop += element.scrollHeight - previousHeight.current;
    } else if (pinned.current) {
      element.scrollTop = element.scrollHeight;
    }
    previousHeight.current = element.scrollHeight;
    previousFirst.current = firstId;
  }, [firstId, lastId, messages.length]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onScroll = () => {
      pinned.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={scroller}
      className="absolute inset-0 overflow-y-auto px-3 py-3 sm:px-[6%]"
      aria-live="polite"
    >
      {hasOlder ? (
        <div className="mb-2 flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[12.5px] shadow-sm transition hover:bg-white disabled:opacity-60"
            style={{ color: WA.icon }}
          >
            {loadingOlder ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            Load older messages
          </button>
        </div>
      ) : null}
      {banner ? <div className="mb-3 flex justify-center">{banner}</div> : null}
      {messages.length === 0 ? (
        <div className="flex h-full min-h-[200px] items-center justify-center">
          {empty}
        </div>
      ) : (
        <ol className="flex flex-col">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const day = chatDayKey(message.occurredAt);
            const newDay = !previous || chatDayKey(previous.occurredAt) !== day;
            const firstOfRun =
              newDay
              || previous.direction !== message.direction
              || (message.direction === "INBOUND"
                && (previous.senderKey ?? null)
                  !== (message.senderKey ?? null));
            return (
              <Fragment key={message.id}>
                {newDay ? (
                  <li className="my-2 flex justify-center" aria-hidden="false">
                    <span
                      className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                      style={{ color: WA.icon }}
                    >
                      {chatDayLabel(message.occurredAt, now)}
                    </span>
                  </li>
                ) : null}
                <li>
                  <Bubble
                    message={message}
                    firstOfRun={firstOfRun}
                    showSender={showSenders}
                    onRetryMedia={onRetryMedia}
                    actions={renderActions?.(message)}
                  />
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** A centred notice chip on the wallpaper, like WhatsApp's system messages. */
export function ChatNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="max-w-md rounded-lg bg-[#fff5c4] px-3 py-1.5 text-center text-[12.5px] leading-snug shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
      style={{ color: "#54656f" }}
    >
      {children}
    </p>
  );
}

/**
 * The composer bar: a rounded field that grows with the message, and a green
 * send button. Enter sends; Shift+Enter is a new line.
 */
export function WhatsAppComposerBar({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  disabledReason,
  placeholder = "Type a message",
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  placeholder?: string;
  maxLength?: number;
}) {
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [value]);

  const canSend = !disabled && !sending && value.trim().length > 0;

  if (disabled && disabledReason) {
    return (
      <div
        className="shrink-0 px-4 py-3 text-center text-[13px]"
        style={{ backgroundColor: WA.panel, color: WA.textMuted }}
      >
        {disabledReason}
      </div>
    );
  }

  return (
    <form
      className="flex shrink-0 items-end gap-2 px-3 py-2.5"
      style={{ backgroundColor: WA.panel }}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <label className="sr-only" htmlFor="whatsapp-composer-field">
        Message
      </label>
      <textarea
        id="whatsapp-composer-field"
        ref={field}
        rows={1}
        value={value}
        maxLength={maxLength}
        disabled={disabled || sending}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter"
            && !event.shiftKey
            && !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (canSend) onSend();
          }
        }}
        className="max-h-[140px] min-h-[42px] flex-1 resize-none rounded-lg border-0 bg-white px-3.5 py-2.5 text-[15px] leading-5 shadow-none outline-none placeholder:text-[#8696a0] focus-visible:ring-2 focus-visible:ring-[#00a884]/40 disabled:opacity-60"
        style={{ color: WA.text }}
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send"
        className="inline-flex size-[42px] shrink-0 items-center justify-center rounded-full text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: WA.accent }}
      >
        {sending ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <SendHorizontal className="size-5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

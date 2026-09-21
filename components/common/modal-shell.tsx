import React from "react";
import { Maximize2, Minimize2, X } from "lucide-react";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  maxWidthClass?: string;
  titleClassName?: string;
  isFullScreenable?: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: (minimize: boolean) => void;
  children: React.ReactNode;
}

export function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = "max-w-[520px]",
  titleClassName,
  isFullScreenable = false,
  isFullScreen = false,
  onToggleFullScreen,
  children,
}: ModalShellProps) {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) {
      onToggleFullScreen?.(true);
    }
  }, [open, onToggleFullScreen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className={`
          flex w-full flex-col bg-background shadow-lg ring-1 ring-border
          transition-all duration-300
          ${
            isFullScreen
              ? "h-full max-h-full max-w-full rounded-none"
              : `max-h-[90vh] ${maxWidthClass} rounded-xl`
          }
        `}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h4
              id={titleId}
              className={`text-base font-bold tracking-tight text-foreground ${
                titleClassName ?? ""
              }`}
            >
              {title}
            </h4>

            {subtitle && (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {isFullScreenable && (
              <button
                type="button"
                onClick={() =>
                  onToggleFullScreen?.(isFullScreen ? true : false)
                }
                className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Toggle fullscreen"
              >
                {isFullScreen ? (
                  <Minimize2 size={16} />
                ) : (
                  <Maximize2 size={16} />
                )}
              </button>
            )}

            <button
              type="button"
              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className={`
            overflow-y-auto px-5 py-4
            ${isFullScreen ? "flex-1" : ""}
          `}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

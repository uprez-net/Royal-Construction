"use client";

import React from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
  React.useEffect(() => {
    if (!open) onToggleFullScreen?.(true);
  }, [open, onToggleFullScreen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        data-mobile-scroll="body"
        showCloseButton={false}
        {...(!subtitle ? { "aria-describedby": undefined } : {})}
        className={cn(
          "flex min-w-0 max-h-[90dvh] flex-col gap-0 overflow-hidden bg-background p-0 shadow-lg",
          maxWidthClass,
          isFullScreen
            && "h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)]",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 pt-2">
            <DialogTitle
              className={cn(
                "break-words text-base font-bold tracking-tight text-foreground",
                titleClassName,
              )}
            >
              {title}
            </DialogTitle>
            {subtitle ? (
              <DialogDescription className="mt-1 text-xs text-muted-foreground">
                {subtitle}
              </DialogDescription>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isFullScreenable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onToggleFullScreen?.(isFullScreen)}
                aria-label={
                  isFullScreen ? "Exit fullscreen" : "Enter fullscreen"
                }
              >
                {isFullScreen ? (
                  <Minimize2 size={16} />
                ) : (
                  <Maximize2 size={16} />
                )}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5",
            isFullScreen && "flex-1",
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

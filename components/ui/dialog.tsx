"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // print:hidden — the scrim is portalled to <body>, so it is a sibling
        // of the page content rather than inside it and survives print rules
        // that hide everything else; left visible it tints every printed page.
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 print:hidden",
        className,
      )}
      {...props}
    />
  );
}

// The floating phone (components/comms/phone-dock.tsx) sits outside every
// dialog yet must stay usable while one is open: hanging up a call never
// closes the dialog it was placed from.
function isPhoneDock(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("[data-phone-dock]") !== null
  );
}

// The last focus target outside every dialog and menu. Radix returns focus on
// close only to a DialogTrigger, which a dialog opened from state (the modal
// manager) does not have, and a field that takes focus on mount (autoFocus) has
// already moved focus before Radix records what to return to. Tracking focus as
// it happens is the only point that sees the opener in both cases. A menu item
// unmounts when its menu closes, so the menu's trigger is what is kept.
let lastFocusOutsideDialog: HTMLElement | null = null;
if (typeof document !== "undefined") {
  const outside = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement
    && !target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]');
  document.addEventListener(
    "focusin",
    (event) => {
      if (outside(event.target)) lastFocusOutsideDialog = event.target;
    },
    true,
  );
  // Focus leaving for nothing (a click on something that takes no focus, as
  // Safari does with buttons) must not leave an old element to be focused later.
  document.addEventListener(
    "focusout",
    (event) => {
      if (outside(event.target) && event.relatedTarget === null) {
        lastFocusOutsideDialog = null;
      }
    },
    true,
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onInteractOutside,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          // Radix runs its own return (the trigger, if there is one) right after
          // this handler. Checked a microtask later: only when that left focus
          // on nothing, and only if the opener is still on the page.
          const opener = lastFocusOutsideDialog;
          queueMicrotask(() => {
            const active = document.activeElement;
            if (
              opener?.isConnected
              && (active === null || active === document.body)
            ) {
              opener.focus();
            }
          });
        }}
        onInteractOutside={(event) => {
          if (isPhoneDock(event.target)) event.preventDefault();
          onInteractOutside?.(event);
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          "scrollbar-none",
          "[-ms-overflow-style:none]",
          "[&::-webkit-scrollbar]:hidden",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

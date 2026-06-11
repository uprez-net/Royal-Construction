"use client";

import type { VariantProps } from "class-variance-authority";
import type { PlateContentProps } from "platejs/react";

import { cva } from "class-variance-authority";
import { PlateContainer, PlateContent } from "platejs/react";

import { cn } from "@/lib/utils";

const editorContainerVariants = cva(
  "relative w-full cursor-text select-text caret-[#0D9488] focus-visible:outline-none",
  {
    defaultVariants: {
      variant: "leadNote",
    },
    variants: {
      variant: {
        leadNote: "overflow-visible",
      },
    },
  },
);

const editorVariants = cva(
  cn(
    "group/editor relative w-full cursor-text select-text overflow-x-hidden whitespace-pre-wrap break-words",
    "rounded-none focus-visible:outline-none [&_a]:text-[#0D9488] [&_a]:underline [&_strong]:font-bold",
  ),
  {
    defaultVariants: {
      variant: "leadNote",
    },
    variants: {
      disabled: {
        true: "cursor-not-allowed opacity-50",
      },
      variant: {
        leadNote:
          "min-h-[180px] px-3 py-3 text-sm leading-6 text-[#0c0a09] [&_li]:ml-5 [&_li]:list-disc [&_p]:my-0",
      },
    },
  },
);

type EditorContainerProps = React.ComponentProps<"div"> &
  VariantProps<typeof editorContainerVariants>;

export function EditorContainer({
  className,
  variant,
  ...props
}: EditorContainerProps) {
  return (
    <PlateContainer
      className={cn(editorContainerVariants({ variant }), className)}
      {...props}
    />
  );
}

export type EditorProps = PlateContentProps &
  VariantProps<typeof editorVariants>;

export function Editor({
  className,
  disabled,
  variant,
  ...props
}: EditorProps) {
  return (
    <PlateContent
      className={cn(editorVariants({ disabled, variant }), className)}
      disabled={disabled}
      disableDefaultStyles
      {...props}
    />
  );
}

"use client";

import { Textarea } from "@/components/ui/textarea";

interface TextBlockListEditorProps {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  rows?: number;
  ariaLabel?: string;
}

export function TextBlockListEditor({
  value,
  onChange,
  placeholder = "One line per scope item",
  rows = 12,
  ariaLabel,
}: TextBlockListEditorProps) {
  return (
    <Textarea
      value={value.join("\n")}
      onChange={(e) => onChange(e.target.value.split("\n"))}
      placeholder={placeholder}
      rows={rows}
      aria-label={ariaLabel}
      className="font-mono text-sm leading-relaxed"
    />
  );
}

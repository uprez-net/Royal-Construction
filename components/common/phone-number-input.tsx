"use client";

import * as React from "react";
import PhoneInput from "react-phone-number-input";

import "react-phone-number-input/style.css";

import { cn } from "@/lib/utils";

export function PhoneNumberInput({
  className,
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof PhoneInput>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <PhoneInput
      international
      defaultCountry="AU"
      value={value || undefined}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      className={cn(
        "[&_.PhoneInputInput]:h-8 [&_.PhoneInputInput]:w-full [&_.PhoneInputInput]:rounded-lg [&_.PhoneInputInput]:border [&_.PhoneInputInput]:border-input [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:px-2.5 [&_.PhoneInputInput]:py-1 [&_.PhoneInputInput]:text-base [&_.PhoneInputInput]:outline-none md:[&_.PhoneInputInput]:text-sm",
        className,
      )}
      {...props}
    />
  );
}
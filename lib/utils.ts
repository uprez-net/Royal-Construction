import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Class name utility combining `clsx` and `twMerge` to produce deduplicated Tailwind class lists.
 * @param inputs - class values accepted by `clsx`
 * @returns merged className string safe for Tailwind
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

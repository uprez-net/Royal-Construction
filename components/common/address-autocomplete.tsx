"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { fetchJson } from "@/utils/fetch";
import type { AddressSuggestion } from "@/types/data";

export type AddressPick = {
  readonly address: string;
  readonly council?: string;
  readonly state?: string;
  readonly postcode?: string;
};

// Free-text address input with a Google/Geoscape (/api/address) suggestion
// dropdown. Unlike SearchableSelect, the TYPED text is always the committed
// value — so a contract-grade address that doesn't autocomplete (rural lots,
// or when the address API keys aren't configured) still saves. Picking a
// suggestion fills the address and surfaces the council/state/postcode via
// onPick (used for the Site Location → Project.council). Fully controlled: the
// `value` prop is the single source of truth.
//
// Implements the ARIA combobox + listbox pattern with full keyboard support
// (Arrow up/down, Enter, Escape, Home/End) so suggestions are usable by keyboard
// and screen-reader users (WCAG 2.1 AA; PR #124 review).
export function AddressAutocomplete({
  value,
  onChange,
  onPick,
  placeholder,
  id,
}: {
  readonly value: string;
  readonly onChange: (address: string) => void;
  readonly onPick?: (pick: AddressPick) => void;
  readonly placeholder?: string;
  readonly id?: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  // Skip the next fetch when the value change came from picking a suggestion,
  // so selecting an address doesn't immediately re-query it.
  const skipNextFetch = useRef(false);
  const reactId = useId();
  const listboxId = `${id ?? reactId}-listbox`;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchJson<{ suggestions: AddressSuggestion[] }>(
          `/api/address?query=${encodeURIComponent(trimmed)}`,
          { method: "GET" },
          "Error fetching address suggestions",
          controller.signal,
        );
        setSuggestions(response.data.suggestions);
        setActiveIndex(-1);
        setOpen(true);
      } catch (error) {
        // A missing API key (500) or any failure degrades gracefully to plain
        // free-text entry; only a real abort is silently ignored.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSuggestions([]);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(optionId(activeIndex))
      ?.scrollIntoView({ block: "nearest" });
    // optionId is derived from stable ids; only the index drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const pick = (suggestion: AddressSuggestion) => {
    const address = suggestion.address || suggestion.label;
    // Only arm the skip-guard when the pick actually changes the value. If the
    // chosen address already equals the current value, onChange is a no-op so the
    // value-effect never runs to clear this flag — leaving it armed would swallow
    // the user's NEXT genuine edit and show no suggestions (PR #124 review).
    skipNextFetch.current = address !== value;
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    onChange(address);
    onPick?.({
      address,
      council: suggestion.council,
      state: suggestion.state,
      postcode: suggestion.postcode,
    });
  };

  const showList = open && suggestions.length > 0 && value.trim().length >= 3;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(suggestions.length - 1);
        break;
      case "Enter":
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          event.preventDefault();
          pick(suggestions[activeIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <Input
        id={id}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          // Drop stale results the moment the query falls below 3 chars, so
          // retyping a 3rd char can't briefly reopen the previous address's
          // suggestions before the new request resolves (PR #124).
          if (next.trim().length < 3) {
            setSuggestions([]);
            setActiveIndex(-1);
            setOpen(false);
          }
          onChange(next);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
      />
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((suggestion, index) => {
            const meta = [
              suggestion.postcode,
              suggestion.council ? `Council: ${suggestion.council}` : null,
            ]
              .filter((part): part is string => Boolean(part?.trim()))
              .join(" · ");
            const isActive = index === activeIndex;
            return (
              <li
                key={suggestion.id}
                id={optionId(index)}
                role="option"
                aria-selected={isActive}
                // Pick on mousedown so the input's blur/outside-click handler
                // doesn't close the list before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(suggestion);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex cursor-pointer flex-col gap-0.5 rounded px-2 py-1.5 text-left ${
                  isActive ? "bg-muted" : ""
                }`}
              >
                <span className="text-sm font-medium text-foreground">
                  {suggestion.label}
                </span>
                {meta ? (
                  <span className="text-xs text-muted-foreground">{meta}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

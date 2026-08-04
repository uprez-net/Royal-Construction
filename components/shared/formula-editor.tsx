"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent,
} from "react";
import { Check, ChevronRight, Variable as VariableIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  validateFormula,
  SUPPORTED_FORMULA_FUNCTIONS,
  type FormulaValidation,
} from "@/lib/offer/formula-validation";

interface FormulaEditorProps {
  /** The current MathJS-compatible formula string. */
  value: string;
  /** Called whenever the formula text changes (validated or not — the parent
   * gates persistence on `onValidationChange`). */
  onChange: (next: string) => void;
  /** Every variable the formula may reference (rate constants + area
   * measurements). Order is preserved in the suggestion list. */
  variables: readonly string[];
  /** Optional sample values keyed by variable name. When supplied the editor
   * shows a live `= <result>` preview below the input. */
  sampleValues?: Record<string, number>;
  /** Stream of validation results so the parent can disable Save until every
   * formula row passes. Called on every change (debounced by the editor). */
  onValidationChange?: (result: FormulaValidation) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

// One suggestion row. `kind` controls the icon + insertion behaviour.
type SuggestionKind = "variable" | "function" | "operator";
interface Suggestion {
  label: string;
  kind: SuggestionKind;
  // The text inserted at the cursor when the user picks this suggestion.
  insertText: string;
  // If true the cursor is placed one char back from the end (inside `()` for
  // functions). If false the cursor lands after the inserted text.
  placeCursorBeforeEnd?: boolean;
}

const OPERATOR_SUGGESTIONS: readonly Suggestion[] = [
  { label: "+ (add)", kind: "operator", insertText: " + " },
  { label: "- (subtract)", kind: "operator", insertText: " - " },
  { label: "* (multiply)", kind: "operator", insertText: " * " },
  { label: "/ (divide)", kind: "operator", insertText: " / " },
  { label: "% (modulo)", kind: "operator", insertText: " % " },
  { label: "^ (power)", kind: "operator", insertText: " ^ " },
  { label: "( ) (group)", kind: "operator", insertText: "()", placeCursorBeforeEnd: true },
  { label: ", (separator)", kind: "operator", insertText: ", " },
];

// Identifier chars per MathJS — letters, digits, underscore, $ (MathJS accepts
// `$` inside identifiers, though we never generate one). Used to detect word
// boundaries when computing the current partial token for autocomplete.
const IDENT_CHAR = /[A-Za-z0-9_$]/;

export function FormulaEditor({
  value,
  onChange,
  variables,
  sampleValues,
  onValidationChange,
  placeholder = "e.g. SLAB_AREA * SLAB_RATE_PER_SQM",
  ariaLabel,
  className,
}: FormulaEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Autocomplete state. `trigger` is the kind of suggestion set to show;
  // `query` is the filter string typed by the user since the menu opened.
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<"variable" | "any" | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Anchor position (caret) so the dropdown floats under it.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  // Recently-inserted variables bubble to the top of future suggestion lists.
  const [recent, setRecent] = useState<string[]>([]);

  // Debounced validation result. We re-run validation 300ms after the last
  // keystroke so we don't thrash MathJS on every character, but we surface the
  // result both to the local UI (error + preview) and to the parent via the
  // `onValidationChange` callback.
  const [validation, setValidation] = useState<FormulaValidation>(() =>
    validateFormula(value, variables, sampleValues),
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runValidation = useCallback(
    (formula: string) => {
      const result = validateFormula(formula, variables, sampleValues);
      setValidation(result);
      onValidationChange?.(result);
    },
    [variables, sampleValues, onValidationChange],
  );

  // Single debounce effect — re-runs when the formula text changes OR when the
  // available variable/sample-value set changes (so a newly-added rate constant
  // immediately re-validates an existing formula, without a separate setState-
  // in-effect).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runValidation(value), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, runValidation]);

  // Build the suggestion list from the active trigger + the current query.
  const suggestions = useMemo<readonly Suggestion[]>(() => {
    if (!open || trigger === null) return [];
    const q = query.toLowerCase();

    const variableList: readonly string[] = variables;
    const variableSuggestions: Suggestion[] = variableList
      .filter((v) => v.toLowerCase().includes(q))
      .map((v) => ({ label: v, kind: "variable" as const, insertText: v }))
      // Recently-used first: stable secondary sort by recency.
      .sort((a, b) => {
        const ai = recent.lastIndexOf(a.label);
        const bi = recent.lastIndexOf(b.label);
        if (bi === -1 && ai === -1) return a.label.localeCompare(b.label);
        return bi - ai;
      });

    if (trigger === "variable") return variableSuggestions;

    // "any" trigger — merge variables + functions + operators, filtered by q.
    const functionSuggestions: Suggestion[] = Array.from(
      SUPPORTED_FORMULA_FUNCTIONS,
    )
      .filter((fn) => fn.toLowerCase().includes(q))
      .sort()
      .map((fn) => ({
        label: `${fn}()`,
        kind: "function" as const,
        insertText: `${fn}()`,
        placeCursorBeforeEnd: true,
      }));

    const operatorSuggestions = OPERATOR_SUGGESTIONS.filter((s) =>
      q === "" ? true : s.label.toLowerCase().includes(q),
    );

    // Variables first, then functions, then operators — matches the natural
    // authoring flow (insert a variable, then an operator, then another).
    return [...variableSuggestions, ...functionSuggestions, ...operatorSuggestions];
  }, [open, trigger, query, variables, recent]);

  // Keep the highlighted index inside the (possibly filtered) list — clamped
  // at render time so no setState-in-effect is needed.
  const clampedActiveIndex =
    suggestions.length === 0 ? 0 : Math.min(activeIndex, suggestions.length - 1);

  // --- Autocomplete open/close + caret anchoring ---------------------------

  const openMenu = useCallback(
    (
      kind: "variable" | "any",
      initialQuery: string,
      atInput: HTMLInputElement,
    ) => {
      const rect = atInput.getBoundingClientRect();
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      // Position the dropdown under the caret, relative to the wrapper.
      setAnchor({
        top: rect.bottom - (wrapperRect?.top ?? 0) + 2,
        left: rect.left - (wrapperRect?.left ?? 0),
      });
      setTrigger(kind);
      setQuery(initialQuery);
      setActiveIndex(0);
      setOpen(true);
    },
    [],
  );

  const closeMenu = useCallback(() => {
    setOpen(false);
    setTrigger(null);
    setQuery("");
    setActiveIndex(0);
  }, []);

  // Compute the partial word the caret is currently inside (or right after).
  // Used both for the auto-open heuristic and for query filtering while typing.
  const currentWordBounds = useCallback(
    (input: HTMLInputElement): { start: number; end: number; word: string } => {
      const pos = input.selectionStart ?? input.value.length;
      const text = input.value;
      let start = pos;
      while (start > 0 && IDENT_CHAR.test(text[start - 1])) start -= 1;
      let end = pos;
      while (end < text.length && IDENT_CHAR.test(text[end])) end += 1;
      return { start, end, word: text.slice(start, end) };
    },
    [],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      const input = e.target;

      // `@` trigger: when the user types `@`, open the variable-only menu and
      // drop the `@` from the stored formula (it's a UI affordance, not part
      // of the MathJS expression).
      if (next.endsWith("@")) {
        const stripped = next.slice(0, -1);
        onChange(stripped);
        openMenu("variable", "", input);
        return;
      }

      onChange(next);

      // Auto-open when the caret starts a fresh word that begins a known
      // variable or function — saves the user from typing `@` every time.
      const { word } = currentWordBounds(input);
      if (word.length >= 1) {
        const matchesVariable = variables.some((v) =>
          v.toLowerCase().startsWith(word.toLowerCase()),
        );
        const matchesFunction = Array.from(SUPPORTED_FORMULA_FUNCTIONS).some(
          (fn) => fn.toLowerCase().startsWith(word.toLowerCase()),
        );
        if (matchesVariable || matchesFunction) {
          if (!open) openMenu("any", word, input);
          else setQuery(word);
        }
      } else if (open) {
        closeMenu();
      }
    },
    [onChange, variables, open, openMenu, closeMenu, currentWordBounds],
  );

  const insertSuggestion = useCallback(
    (s: Suggestion) => {
      const input = inputRef.current;
      if (!input) return;
      const pos = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? value.length;

      const insertText = s.insertText;
      // Strip a leading `@` if it's still at the caret (the trigger char that
      // opened the menu).
      let start = pos;
      if (value[start - 1] === "@") start -= 1;

      const before = value.slice(0, start);
      const after = value.slice(end);
      const next = before + insertText + after;

      onChange(next);

      // Track recency for variables.
      if (s.kind === "variable") {
        setRecent((prev) =>
          [...prev.filter((r) => r !== s.label), s.label].slice(-8),
        );
      }

      // Place the caret. For function/operator insertions that end in `)`,
      // position the cursor one char back so the user lands inside the parens.
      const cursorTarget =
        s.placeCursorBeforeEnd && insertText.endsWith(")")
          ? before.length + insertText.length - 1
          : before.length + insertText.length;
      // Defer focus/selection to after React commits the new value.
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(cursorTarget, cursorTarget);
        // Re-anchor the dropdown for the new caret position if still open.
        if (open) {
          const rect = input.getBoundingClientRect();
          const wrapperRect = wrapperRef.current?.getBoundingClientRect();
          setAnchor({
            top: rect.bottom - (wrapperRect?.top ?? 0) + 2,
            left: rect.left - (wrapperRect?.left ?? 0),
          });
        }
      });

      closeMenu();
    },
    [value, onChange, open, closeMenu],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // Ctrl+Space — manually invoke autocomplete from the caret position.
      if ((e.ctrlKey || e.metaKey) && e.key === " ") {
        e.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        const { word } = currentWordBounds(input);
        openMenu("any", word, input);
        return;
      }

      if (!open) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        if (suggestions[clampedActiveIndex]) {
          e.preventDefault();
          insertSuggestion(suggestions[clampedActiveIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.key === "Tab" && suggestions[clampedActiveIndex]) {
        // Tab also inserts — keeps keyboard-only authoring fast.
        e.preventDefault();
        insertSuggestion(suggestions[clampedActiveIndex]);
      }
    },
    [open, suggestions, clampedActiveIndex, insertSuggestion, closeMenu, currentWordBounds, openMenu],
  );

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closeMenu]);

  const hasError = !validation.valid && value.trim().length > 0;
  const preview = validation.valid && validation.preview !== null
    ? formatNumber(validation.preview)
    : null;

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Defer close so a click on a suggestion item still fires first.
          setTimeout(() => closeMenu(), 120);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={hasError || undefined}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "h-8 w-full rounded-md border bg-transparent px-3 font-mono text-sm shadow-xs outline-none transition-colors",
          "focus-visible:border-royal-gold focus-visible:ring-2 focus-visible:ring-royal-gold/40",
          hasError
            ? "border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/30"
            : "border-input",
        )}
      />

      {/* Autocomplete dropdown */}
      {open && suggestions.length > 0 && anchor && (
        <div
          role="listbox"
          aria-label="Formula suggestions"
          className="absolute z-50 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md"
          style={{ top: anchor.top, left: anchor.left }}
        >
          {trigger === "variable" && (
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Variables
            </div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}:${s.label}`}
              type="button"
              role="option"
              aria-selected={i === clampedActiveIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                // mousedown — fires before blur, so the input keeps focus.
                e.preventDefault();
                insertSuggestion(s);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors",
                i === clampedActiveIndex
                  ? "bg-royal-gold-light text-foreground"
                  : "text-popover-foreground hover:bg-muted",
              )}
            >
              <SuggestionIcon kind={s.kind} />
              <span className={cn("flex-1 truncate", s.kind === "function" && "font-mono")}>
                {s.label}
              </span>
              {i === clampedActiveIndex && (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      )}
      {open && suggestions.length === 0 && anchor && (
        <div
          className="absolute z-50 w-64 rounded-md border border-border bg-popover p-3 text-xs text-muted-foreground shadow-md"
          style={{ top: anchor.top, left: anchor.left }}
        >
          No matching suggestions.
        </div>
      )}

      {/* Inline validation + preview row */}
      <div className="mt-1 min-h-4 text-xs">
        {hasError ? (
          <span role="alert" className="text-destructive">
            {validation.error}
          </span>
        ) : preview !== null ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Check className="size-3 text-success" aria-hidden="true" />
            <span className="font-mono">= {preview}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionIcon({ kind }: { kind: SuggestionKind }) {
  if (kind === "variable") {
    return <VariableIcon className="size-3.5 shrink-0 text-royal-gold" aria-hidden="true" />;
  }
  if (kind === "function") {
    return (
      <span className="font-mono text-[10px] font-semibold text-muted-foreground">
        ƒ
      </span>
    );
  }
  return (
    <span className="font-mono text-xs font-semibold text-muted-foreground">
      ⊕
    </span>
  );
}

function formatNumber(n: number): string {
  // Group thousands for the preview readout so big totals stay readable.
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString("en-AU", { maximumFractionDigits: 2 });
}
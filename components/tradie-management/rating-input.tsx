import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef, useState, type KeyboardEvent } from "react";

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  readonly?: boolean;
  size?: number;
  /** Id of the visible label describing this radiogroup. */
  labelledById?: string;
}

export function StarRatingInput({
  value,
  onChange,
  max = 5,
  readonly = false,
  size = 22,
  labelledById,
}: StarRatingInputProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const displayValue = hovered ?? value;
  // A radiogroup is a single tab stop: the checked option holds tabIndex 0, or
  // the first option when nothing is selected yet.
  const activeRating = value >= 1 && value <= max ? Math.round(value) : 1;

  const moveTo = (rating: number) => {
    const clamped = Math.min(max, Math.max(1, rating));
    onChange(clamped);
    optionRefs.current[clamped - 1]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    rating: number,
  ) => {
    if (readonly) return;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveTo(rating === max ? 1 : rating + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveTo(rating === 1 ? max : rating - 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(1);
        break;
      case "End":
        event.preventDefault();
        moveTo(max);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label={labelledById ? undefined : "Rating"}
        aria-labelledby={labelledById}
      >
        {Array.from({ length: max }, (_, index) => {
          const rating = index + 1;
          const filled = rating <= displayValue;

          return (
            <button
              key={rating}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              disabled={readonly}
              role="radio"
              aria-checked={rating === value}
              aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
              tabIndex={rating === activeRating ? 0 : -1}
              onClick={() => onChange(rating)}
              onKeyDown={(event) => handleKeyDown(event, rating)}
              onMouseEnter={() => setHovered(rating)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "rounded-sm transition-transform motion-reduce:transition-none",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                !readonly &&
                  "cursor-pointer hover:scale-110 motion-reduce:hover:scale-100",
              )}
            >
              {/* Fill — not hue — is the cue that a star is earned, so the
                  rating still reads without colour perception. */}
              <Star
                size={size}
                className={cn(
                  "transition-colors motion-reduce:transition-none",
                  filled
                    ? "fill-warning text-warning"
                    : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <span className="min-w-9 text-sm font-medium tabular-nums">
        {displayValue.toFixed(1)}
      </span>
    </div>
  );
}

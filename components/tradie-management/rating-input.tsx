import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  readonly?: boolean;
  size?: number;
}

export function StarRatingInput({
  value,
  onChange,
  max = 5,
  readonly = false,
  size = 22,
}: StarRatingInputProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const displayValue = hovered ?? value;

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label="Rating"
      >
        {Array.from({ length: max }, (_, index) => {
          const rating = index + 1;
          const filled = rating <= displayValue;

          return (
            <button
              key={rating}
              type="button"
              disabled={readonly}
              role="radio"
              aria-checked={rating === value}
              onClick={() => onChange(rating)}
              onMouseEnter={() => setHovered(rating)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "transition-transform",
                !readonly && "hover:scale-110 cursor-pointer",
              )}
            >
              <Star
                size={size}
                className={cn(
                  "transition-colors",
                  filled
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground",
                )}
              />
            </button>
          );
        })}
      </div>

      <span className="min-w-9 text-sm font-medium">
        {displayValue.toFixed(1)}
      </span>
    </div>
  );
}

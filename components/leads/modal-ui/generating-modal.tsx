// ─── Loading Modal Component ────────────────────────────────────────────────

import { Sparkles } from "lucide-react";
import { useState, useEffect } from "react";

interface GeneratingModalProps {
  /** The accent/border color for the spinner, progress bar, and text */
  borderColor?: string;
  /** Kept for callers; the flat layout no longer draws a background glow. */
  backgroundColor?: string;
}

export function GeneratingModal({
  borderColor = "var(--royal-gold-ink)",
}: GeneratingModalProps) {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  const messages = [
    "Analyzing your requirements...",
    "Drafting the email layout...",
    "Applying Royal Constructions theme...",
    "Generating interactive elements...",
    "Polishing the final touches...",
  ];

  useEffect(() => {
    // Simulate a smooth progress bar over ~20 seconds
    const duration = 2000;
    const interval = 100;
    const step = 100 / (duration / interval);

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 98) return prev; // Pause at 98% until actually finished
        return prev + step / 100;
      });
    }, interval);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Cycle through status messages every 3 seconds
    const messageTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 3000);

    return () => clearInterval(messageTimer);
  }, [messages.length]);

  return (
    <div className="flex items-center justify-center py-10 w-full">
      <div className="relative flex flex-col items-center gap-8 w-full overflow-hidden px-4 py-8">
        {/* Animated Icon Container */}
        <div className="relative flex h-24 w-24 items-center justify-center">
          {/* Rotating Ring */}
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
            style={{
              borderTopColor: borderColor,
              borderRightColor: `color-mix(in oklab, ${borderColor} 50%, transparent)`,
              animationDuration: "1.5s",
            }}
          ></div>

          {/* Center Icon */}
          <div className="relative z-10 flex items-center justify-center">
            <Sparkles className="h-8 w-8" style={{ color: borderColor }} />
          </div>
        </div>

        {/* Text Content */}
        <div className="relative flex flex-col items-center gap-3 text-center z-10">
          <h3 className="text-2xl font-semibold text-foreground tracking-tight">
            Generating Your Email
          </h3>

          {/* Dynamic Message with fade transition */}
          <div className="h-6 flex items-center justify-center">
            <p
              key={messageIndex}
              className="text-sm font-medium text-muted-foreground animate-fade-in-down"
            >
              {messages[messageIndex]}
            </p>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
            Our AI is crafting your custom HTML template. This usually takes
            about 15-20 seconds.
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted rounded-full h-2 overflow-hidden z-10">
          <div
            className="h-2 rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${Math.min(progress, 100)}%`,
              backgroundColor: borderColor,
            }}
          ></div>
        </div>

        <p className="text-xs text-muted-foreground z-10">
          Please don&apos;t close or refresh this page
        </p>

        {/* Custom CSS for text animation */}
        <style>{`
          @keyframes fadeInDown {
            0% {
              opacity: 0;
              transform: translateY(-8px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .animate-fade-in-down {
            animation: fadeInDown 0.4s ease-out forwards;
          }
        `}</style>
      </div>
    </div>
  );
}

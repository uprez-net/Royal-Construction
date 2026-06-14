// ─── Loading Modal Component ────────────────────────────────────────────────

import { Sparkles } from "lucide-react";
import { useState , useEffect} from "react";

export function GeneratingModal() {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  const messages = [
    'Analyzing your requirements...',
    'Drafting the email layout...',
    'Applying Royal Constructions theme...',
    'Generating interactive elements...',
    'Polishing the final touches...',
  ];

  useEffect(() => {
    // Simulate a smooth progress bar over ~20 seconds
    const duration = 20000; 
    const interval = 100;
    const step = 100 / (duration / interval);

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 98) return prev; // Pause at 98% until actually finished
        return prev + (step / 100);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md">
      <div className="relative flex flex-col items-center gap-8 rounded-2xl border border-[#E2E8F0] bg-white px-12 py-10 shadow-2xl sm:max-w-md w-full mx-4 overflow-hidden">
        
        {/* Decorative background glow */}
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-[#C6923A]/20 blur-3xl transition-all animate-pulse"></div>

        {/* Animated Icon Container */}
        <div className="relative flex h-24 w-24 items-center justify-center">
          {/* Rotating Ring */}
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#C6923A] border-r-[#C6923A]/50 animate-spin" style={{ animationDuration: '1.5s' }}></div>
          
          {/* Inner Pulsing Circle */}
          <div className="absolute inset-2 rounded-full bg-[#F7F6F2] border border-[#E2E8F0] animate-pulse"></div>

          {/* Center Icon */}
          <div className="relative z-10 flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-[#C6923A]" />
          </div>
        </div>

        {/* Text Content */}
        <div className="relative flex flex-col items-center gap-3 text-center z-10">
          <h3 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Generating Your Email
          </h3>
          
          {/* Dynamic Message with fade transition */}
          <div className="h-6 flex items-center justify-center">
            <p 
              key={messageIndex} 
              className="text-sm font-medium text-[#C6923A] animate-fade-in-down"
            >
              {messages[messageIndex]}
            </p>
          </div>
          
          <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
            Our AI is crafting your custom HTML template. This usually takes about 15-20 seconds.
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden z-10">
          <div 
            className="bg-[#C6923A] h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.min(progress, 100)}%` }}
          ></div>
        </div>
        
        <p className="text-xs text-slate-400 z-10">
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
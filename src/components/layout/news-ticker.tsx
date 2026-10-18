import { useState } from "react";
import { X, Sparkles } from "lucide-react";

export function NewsTicker() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("gymgate_ticker_hidden") === "true";
    } catch {
      return false;
    }
  });

  const hideTicker = () => {
    setHidden(true);
    try {
      localStorage.setItem("gymgate_ticker_hidden", "true");
    } catch {
      // ignore
    }
  };

  if (hidden) return null;

  const text = "GymGate  •  Powered by KOTB Digital Solutions";
  const repeated = Array(4).fill(text).join("   ★   ");

  return (
    <div className="group/ticker relative h-7 shrink-0 overflow-hidden border-b border-white/[0.06] bg-gradient-to-r from-[#0055FF]/10 via-[#06080E] to-[#00D2FF]/10 backdrop-blur-md flex items-center">
      <div className="pointer-events-none absolute inset-y-0 start-0 z-10 w-16 bg-gradient-to-e from-[#06080E] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 end-0 z-10 w-16 bg-gradient-to-w from-[#06080E] to-transparent" />

      <div className="animate-marquee flex h-full items-center whitespace-nowrap text-xs font-semibold tracking-wide text-[#00D2FF]">
        <span className="mx-8 flex items-center gap-2">
          <Sparkles className="size-3 text-amber-400 inline" />
          {repeated}
        </span>
        <span className="mx-8 flex items-center gap-2">
          <Sparkles className="size-3 text-amber-400 inline" />
          {repeated}
        </span>
      </div>

      <button
        type="button"
        onClick={hideTicker}
        title="إخفاء الشريط الترويجي"
        className="absolute end-2 z-20 opacity-0 group-hover/ticker:opacity-100 transition-opacity size-5 grid place-items-center rounded bg-black/60 text-slate-400 hover:text-white"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

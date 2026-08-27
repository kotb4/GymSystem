export function NewsTicker() {
  const text = "Yassen Mohamed Kotb | 01288536381";
  const repeated = Array(6).fill(text).join("   ★   ");

  return (
    <div className="relative h-7 overflow-hidden border-b border-line bg-panel/60 backdrop-blur">
      <div className="pointer-events-none absolute inset-y-0 start-0 z-10 w-16 bg-gradient-to-e from-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 end-0 z-10 w-16 bg-gradient-to-w from-panel to-transparent" />
      <div className="animate-marquee flex h-full items-center whitespace-nowrap text-xs font-medium tracking-wide text-neon/70">
        <span className="mx-8">{repeated}</span>
        <span className="mx-8">{repeated}</span>
      </div>
    </div>
  );
}

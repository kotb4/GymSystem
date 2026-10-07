export type Accent = "neon" | "cyan" | "violet" | "amber" | "red" | "emerald";

export const ACCENT_TINTS: Record<Accent, string> = {
  neon: "bg-primary/10 text-primary border-primary/20",
  cyan: "bg-cyan/10 text-cyan border-cyan/20",
  violet: "bg-violet/10 text-violet border-violet/20",
  amber: "bg-amber/10 text-amber border-amber/20",
  red: "bg-red/10 text-red border-red/20",
  emerald: "bg-emerald/10 text-emerald border-emerald/20",
};

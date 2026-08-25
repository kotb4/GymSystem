export type Accent = "neon" | "cyan" | "violet" | "amber" | "red";

export const ACCENT_TINTS: Record<Accent, string> = {
  neon: "bg-neon/10 text-neon",
  cyan: "bg-cyan/10 text-cyan",
  violet: "bg-violet/10 text-violet",
  amber: "bg-amber/10 text-amber",
  red: "bg-red/10 text-red",
};

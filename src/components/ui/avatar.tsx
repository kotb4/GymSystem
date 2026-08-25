import { cn } from "@/utils/cn";

const SIZES = {
  sm: "size-8 text-[11px]",
  md: "size-10 text-[13px]",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
} as const;

const PALETTES = [
  { bg: "rgba(57,255,136,0.14)", fg: "#39FF88" },
  { bg: "rgba(0,229,255,0.13)", fg: "#00E5FF" },
  { bg: "rgba(155,92,255,0.15)", fg: "#9B5CFF" },
  { bg: "rgba(255,197,61,0.14)", fg: "#FFC53D" },
] as const;

export interface AvatarProps {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("") || "؟"
  );
}

export function Avatar({ name, size = "md", className }: AvatarProps) {
  const palette = PALETTES[name.replace(/\s/g, "").length % PALETTES.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 select-none place-items-center rounded-full font-bold ring-1 ring-white/10",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: palette.bg, color: palette.fg }}
    >
      {initialsOf(name)}
    </span>
  );
}

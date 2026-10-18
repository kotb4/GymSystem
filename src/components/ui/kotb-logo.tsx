import { useState } from "react";
import { cn } from "@/utils/cn";

export interface KotbLogoProps {
  className?: string;
  variant?: "dark" | "light" | "icon" | "navy";
  markOnly?: boolean;
  showSubtitle?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  alt?: string;
}

const HEIGHT_MAP = {
  xs: "h-6",
  sm: "h-8",
  md: "h-10",
  lg: "h-12",
  xl: "h-16",
};

const ICON_SIZE_MAP = {
  xs: "size-6",
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-16",
};

export function KotbLogo({
  className,
  variant = "dark",
  markOnly = false,
  size = "md",
  alt = "KOTB Digital Solutions",
}: KotbLogoProps) {
  const [hasError, setHasError] = useState(false);

  // Source selection based on variant
  const src = markOnly || variant === "icon"
    ? "/branding/kotb-k-icon.png"
    : variant === "light"
      ? "/branding/kotb-logo-light.png"
      : "/branding/kotb-logo.png";

  if (hasError) {
    return (
      <div className={cn("inline-flex items-center gap-2 select-none", className)}>
        <span className="font-black tracking-tight text-white font-sans text-xl">
          KOTB
        </span>
        <span className="size-1.5 rounded-full bg-[#0055FF] shadow-sm" />
        {!markOnly && (
          <span className="text-[10px] font-bold tracking-widest uppercase font-mono text-[#94A3B8]">
            Digital Solutions
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setHasError(true)}
      className={cn(
        "object-contain select-none transition-transform duration-200",
        markOnly || variant === "icon" ? ICON_SIZE_MAP[size] : HEIGHT_MAP[size],
        className
      )}
      loading="eager"
    />
  );
}

export default KotbLogo;

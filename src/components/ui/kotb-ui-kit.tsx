import React from "react";

/**
 * KOTB Digital Solutions — Universal Brand Components for Any Project
 * Copy or adapt these components into any React / Next.js / Vite project.
 */

export interface KotbLogoProps {
  variant?: "full" | "icon" | "light";
  className?: string;
  height?: number;
}

export const KotbLogo: React.FC<KotbLogoProps> = ({
  variant = "full",
  className = "",
  height = 36,
}) => {
  const src =
    variant === "icon"
      ? "/branding/kotb-k-icon.png"
      : variant === "light"
      ? "/branding/kotb-logo-light.png"
      : "/branding/kotb-logo.png";

  return (
    <img
      src={src}
      alt="KOTB Digital Solutions"
      style={{ height: `${height}px`, width: "auto", objectFit: "contain" }}
      className={`select-none ${className}`}
    />
  );
};

export interface KotbPoweredBadgeProps {
  productName?: string;
  className?: string;
}

export const KotbPoweredBadge: React.FC<KotbPoweredBadgeProps> = ({
  productName,
  className = "",
}) => (
  <div
    className={`inline-flex items-center gap-2 rounded-full bg-[#0F1420] border border-[#0055FF]/35 px-3.5 py-1 text-xs font-semibold text-[#E2E8F0] shadow-[0_0_14px_rgba(0,85,255,0.22)] ${className}`}
  >
    <img
      src="/branding/kotb-k-icon.png"
      alt="KOTB"
      className="h-3.5 w-3.5 object-contain"
    />
    <span>
      {productName ? `${productName} — ` : ""}Powered by{" "}
      <strong className="text-white">KOTB Digital Solutions</strong>
    </span>
  </div>
);

export const KotbSidebarFooterCard: React.FC<{ productName?: string }> = ({
  productName,
}) => (
  <div className="rounded-xl bg-[#06080D] border border-[#0055FF]/30 p-3.5 shadow-[0_0_20px_rgba(0,85,255,0.12)]">
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F1420] border border-[#0055FF]/40">
        <img
          src="/branding/kotb-k-icon.png"
          alt="KOTB"
          className="h-5 w-5 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold tracking-wide text-white">
          KOTB Digital Solutions
        </div>
        <div className="truncate text-[11px] font-medium text-[#0055FF]">
          {productName ? `${productName} • ` : ""}Official Enterprise System
        </div>
      </div>
    </div>
  </div>
);

export const KotbSplashScreen: React.FC<{ productName?: string }> = ({
  productName,
}) => (
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#06080D] text-white">
    <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-[#0F1420] border border-[#0055FF]/40 shadow-[0_0_32px_rgba(0,85,255,0.35)] animate-pulse">
      <img
        src="/branding/kotb-k-icon.png"
        alt="KOTB"
        className="h-12 w-12 object-contain"
      />
    </div>
    {productName && (
      <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
        {productName}
      </h1>
    )}
    <p className="mt-2 text-xs font-semibold tracking-widest uppercase text-[#0055FF]">
      Powered by KOTB Digital Solutions
    </p>
  </div>
);

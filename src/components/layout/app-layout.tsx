import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useT } from "@/i18n";
import { routeTitleKey } from "@/routes/nav-routes";
import { useAuth } from "@/contexts/auth-context";
import { useLicense } from "@/contexts/license-context";
import { useBootMaintenance } from "@/hooks/use-boot-maintenance";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { NewsTicker } from "./news-ticker";

export function AppLayout() {
  const t = useT();
  const location = useLocation();
  const { actor } = useAuth();
  const license = useLicense();

  useBootMaintenance(actor);

  useEffect(() => {
    document.title = `${t(routeTitleKey(location.pathname))} — ${t("app.name")}`;
  }, [location.pathname, t]);

  const licenseStatus = license.status;
  const activeMsg =
    licenseStatus && licenseStatus.state === "active" && licenseStatus.daysRemaining > 0
      ? t("license.bannerActive", { days: String(licenseStatus.daysRemaining) })
      : null;
  const hardMsg =
    licenseStatus &&
    (licenseStatus.state === "expired" || licenseStatus.state === "tampered" || licenseStatus.readOnly)
      ? licenseStatus.tampered
        ? t("license.bannerTampered")
        : t("license.bannerExpired")
      : null;

  const bannerMsg = hardMsg ?? activeMsg;
  const bannerTone = licenseStatus?.tampered
    ? "border-red/30 bg-red/10 text-red"
    : licenseStatus?.readOnly
      ? "border-amber/40 bg-amber/10 text-amber"
      : "border-neon/30 bg-neon/10 text-neon";

  return (
    <div className="relative isolate flex h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-44 start-[22%] size-[480px] rounded-full bg-neon/[0.05] blur-[130px]" />
        <div className="absolute -bottom-40 end-[8%] size-[420px] rounded-full bg-cyan/[0.04] blur-[130px]" />
      </div>

      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <NewsTicker />
        {(bannerMsg && (
          <div className={`border-b px-4 py-2 text-center text-[13px] font-semibold ${bannerTone}`}>
            {bannerMsg}
          </div>
        ))}
        <main className="flex-1 overflow-y-auto">
          <div key={location.pathname} className="mx-auto w-full max-w-[1440px] animate-fade-up px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

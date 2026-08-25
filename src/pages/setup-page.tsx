import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Rocket, HardDriveDownload } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { postRaw } from "@/api/client";

interface ImportReport {
  after?: Record<string, number>;
}

export function SetupPage() {
  const t = useT();
  const { needsSetup, setup } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [gymName, setGymName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacySize, setLegacySize] = useState<string | null>(null);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyDone, setLegacyDone] = useState(false);

  useEffect(() => {
    document.title = `${t("setup.title")} — ${t("app.name")}`;
    let alive = true;
    // detect data left behind by the old browser-storage version
    void import("@/legacy/idb-export").then(async (mod) => {
      try {
        const bytes = await mod.loadLegacyBrowserDbBytes();
        if (alive && bytes && bytes.length > 100) setLegacySize(mod.describeBytes(bytes));
      } catch {
        /* no legacy data */
      }
    });
    return () => {
      alive = false;
    };
  }, [t]);

  if (!needsSetup) {
    return <Navigate to="/" replace />;
  }

  const onImportLegacy = async () => {
    setLegacyBusy(true);
    setError(null);
    try {
      const mod = await import("@/legacy/idb-export");
      const bytes = await mod.loadLegacyBrowserDbBytes();
      if (!bytes) throw new Error("no legacy data");
      const report = await postRaw<ImportReport>("/api/system/import-legacy", bytes);
      setLegacyDone(true);
      toast(
        "success",
        `${t("setup.legacyDone")} (${report.after?.members ?? 0} ${t("members.count", { count: "" }).replace("{count} ", "")})`.trim(),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpected"));
    } finally {
      setLegacyBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!gymName.trim() || !ownerFullName.trim() || !username.trim() || !password) {
      setError(t("errors.fullNameRequired"));
      return;
    }
    setSubmitting(true);
    const result = await setup({ gymName, ownerFullName, username, password });
    setSubmitting(false);
    if (result.ok) {
      toast("success", t("toast.loggedIn"));
      navigate("/", { replace: true });
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-base px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 start-1/2 size-[560px] -translate-x-1/2 rounded-full bg-neon/[0.07] blur-[140px]" />
        <div className="absolute -bottom-40 -start-24 size-[420px] rounded-full bg-cyan/[0.05] blur-[130px]" />
      </div>

      <div className="w-full max-w-[480px]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div>
            <h1 className="text-xl font-extrabold">{t("setup.title")}</h1>
            <p className="mt-1 text-xs text-subtle">{t("setup.subtitle")}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-neon/30 bg-neon/10 px-3 py-1 text-[11px] font-bold text-neon">
              <Rocket className="size-3" />
              {t("setup.stepInfo")}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-7 shadow-card">
          {legacySize && !legacyDone && (
            <div className="mb-5 rounded-xl border border-neon/30 bg-neon/5 p-4">
              <p className="flex items-center gap-2 text-[13px] font-bold">
                <HardDriveDownload className="size-4 text-neon" />
                {t("setup.legacyTitle")}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-subtle">
                {t("setup.legacyDesc", { size: legacySize })}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                loading={legacyBusy}
                disabled={legacyBusy}
                onClick={() => void onImportLegacy()}
              >
                {t("setup.legacyImportBtn")}
              </Button>
            </div>
          )}
          {legacyDone && (
            <p className="mb-5 rounded-xl border border-neon/30 bg-neon/10 px-3.5 py-2.5 text-[13px] font-semibold text-neon">
              {t("setup.legacyDone")}
            </p>
          )}
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Input
              label={t("setup.gymName")}
              placeholder={t("setup.gymNamePh")}
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
              disabled={submitting}
              autoFocus
            />
            <Input
              label={t("setup.ownerName")}
              placeholder={t("setup.ownerNamePh")}
              value={ownerFullName}
              onChange={(e) => setOwnerFullName(e.target.value)}
              disabled={submitting}
            />
            <div className="space-y-1.5">
              <label htmlFor="setup-username" className="block text-[13px] font-semibold text-subtle">
                {t("setup.username")}
              </label>
              <Input
                id="setup-username"
                dir="ltr"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
              <p className="text-[11px] text-faint">{t("setup.usernameHint")}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="setup-password" className="block text-[13px] font-semibold text-subtle">
                {t("auth.password")}
              </label>
              <PasswordInput
                id="setup-password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <p className="text-[11px] text-faint">{t("setup.strengthWeak")}</p>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red"
              >
                {error}
              </div>
            )}

            <Button type="submit" size="lg" fullWidth loading={submitting} disabled={submitting}>
              {submitting ? t("setup.submitting") : t("setup.confirm")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

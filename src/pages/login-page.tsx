import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn, User } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginPage() {
  const t = useT();
  const { user, booting, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = `${t("auth.title")} — ${t("app.name")}`;
  }, [t]);

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-base">
        <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-neon" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const nextErrors: typeof errors = {};
    if (!username.trim()) nextErrors.username = t("auth.errUsername");
    if (!password) nextErrors.password = t("auth.errPassword");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = await login(username.trim(), password);
    setSubmitting(false);

    if (result.ok) {
      toast("success", t("toast.loggedIn"));
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } else {
      setFormError(result.error ?? t("errors.invalidCredentials"));
    }
  };

  return (
    <div className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-base px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 start-1/2 size-[560px] -translate-x-1/2 rounded-full bg-neon/[0.07] blur-[140px]" />
        <div className="absolute -bottom-40 -start-24 size-[420px] rounded-full bg-cyan/[0.05] blur-[130px]" />
        <div className="absolute -top-20 -end-24 size-[360px] rounded-full bg-violet/[0.05] blur-[120px]" />
      </div>

      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div>
            <h1 className="text-xl font-extrabold">{t("app.name")}</h1>
            <p className="mt-1 text-xs text-faint">{t("app.tagline")}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-7 shadow-card">
          <div className="mb-6">
            <h2 className="text-lg font-extrabold">{t("auth.title")}</h2>
            <p className="mt-1 text-[13px] text-subtle">{t("auth.subtitle")}</p>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Input
              label={t("auth.username")}
              icon={<User className="size-4" />}
              dir="ltr"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrors((p) => ({ ...p, username: undefined }));
              }}
              error={errors.username}
              disabled={submitting}
            />

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-[13px] font-semibold text-subtle">
                {t("auth.password")}
              </label>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((p) => ({ ...p, password: undefined }));
                }}
                disabled={submitting}
              />
              {errors.password && (
                <p role="alert" className="text-xs font-semibold text-red">
                  {errors.password}
                </p>
              )}
            </div>

            {formError && (
              <div
                role="alert"
                className="animate-shake rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold leading-relaxed text-red"
              >
                {formError}
              </div>
            )}

            <Button type="submit" size="lg" fullWidth loading={submitting} disabled={submitting}>
              {submitting ? t("auth.submitting") : t("auth.submit")}
              {!submitting && <LogIn className="size-4" />}
            </Button>
          </form>
        </div>

        <p className="mt-8 text-center text-[11px] text-faint">
          © 2026 {t("app.name")} — {t("app.rights")}
        </p>
      </div>
    </div>
  );
}

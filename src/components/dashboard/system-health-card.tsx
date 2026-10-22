import { useState, useEffect } from "react";
import {
  AlertTriangle,
  HardDrive,
  KeyRound,
  Clock,
  ExternalLink,
} from "lucide-react";
import { api, type LicenseStatus, type PublicBackupEntry } from "@/api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { formatDateShort, formatTime } from "@/services/format";

export function SystemHealthCard() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [latestBackup, setLatestBackup] = useState<PublicBackupEntry | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  const canView = hasPermission("settings.view") || hasPermission("reports.view");

  const loadHealthData = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const [backupsRes, licRes] = await Promise.allSettled([
        api.backup.entries(1),
        api.license.status(),
      ]);

      if (backupsRes.status === "fulfilled" && Array.isArray(backupsRes.value) && backupsRes.value.length > 0) {
        setLatestBackup(backupsRes.value[0] as PublicBackupEntry);
      } else {
        setLatestBackup(null);
      }

      if (licRes.status === "fulfilled") {
        setLicense(licRes.value);
      }
    } catch (err) {
      console.error("Failed to load health telemetry:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHealthData();
  }, [canView]);

  const handleManualBackup = async () => {
    setBackingUp(true);
    try {
      await api.backup.createSnapshot("manual");
      toast("success", "تم إنشاء نسخة احتياطية جديدة بنجاح");
      await loadHealthData();
    } catch (err) {
      console.error("Backup failed:", err);
      toast("error", "فشل إنشاء النسخة الاحتياطية — تحقق من مساحة القرص");
    } finally {
      setBackingUp(false);
    }
  };

  const openWhatsAppSupport = () => {
    const hwid = license?.hwid ?? "غير معروف";
    const msg = `السلام عليكم، أحتاج دعم فني لنظام GymGate\nكود جهازي: ${hwid}`;
    const url = buildWhatsAppDirectUrl("01288536381", msg);
    if (url) window.open(url, "_blank");
  };

  if (!canView) return null;

  // Calculate backup age
  let isBackupStale = false;
  let backupAgeHours = 0;
  if (latestBackup?.createdAt) {
    const backupTime = new Date(latestBackup.createdAt).getTime();
    backupAgeHours = Math.floor((Date.now() - backupTime) / (1000 * 60 * 60));
    isBackupStale = backupAgeHours >= 24;
  } else if (!loading) {
    isBackupStale = true;
  }

  const isTampered = license?.tampered ?? false;

  return (
    <div className="rounded-2xl border border-line bg-surface/80 p-4 shadow-sm backdrop-blur-sm space-y-4">
      {/* Top Banner if Stale Backup or Tampered Clock */}
      {isBackupStale && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-5 shrink-0 text-amber-400 animate-pulse" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold">تنبيه حماية البيانات:</span> لم يتم أخذ نسخة احتياطية منذ أكثر من {backupAgeHours > 0 ? `${backupAgeHours} ساعة` : "24 ساعة"}. يُرجى تأمين بيانات الجيم الآن.
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleManualBackup}
            disabled={backingUp}
            className="bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs shrink-0"
          >
            {backingUp ? "جارٍ الحفظ..." : "أخذ نسخة احتياطية الآن"}
          </Button>
        </div>
      )}

      {isTampered && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-red-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-5 shrink-0 text-red-400" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold">تحذير أمني:</span> تم رصد تراجع في ساعة جهاز الكمبيوتر. يعمل النظام الآن بوضع القراءة فقط لحماية اشتراكات وحسابات الأعضاء.
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={openWhatsAppSupport}
            className="text-xs shrink-0 border-red-500/40 text-red-200"
          >
            تواصل مع الدعم الفني
          </Button>
        </div>
      )}

      {/* Main Health Telemetry Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 1. Backup Status */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-panel-border/60 bg-panel/40">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isBackupStale ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>
              <HardDrive className="size-4" />
            </div>
            <div>
              <div className="text-xs text-subtle font-medium">النسخ الاحتياطي التلقائي</div>
              <div className="text-xs font-bold text-ink mt-0.5">
                {latestBackup ? (
                  `${formatDateShort(new Date(latestBackup.createdAt))} (${formatTime(latestBackup.createdAt)})`
                ) : (
                  "لا توجد نسخ مسجلة"
                )}
              </div>
            </div>
          </div>
          <span className={`size-2.5 rounded-full ${isBackupStale ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
        </div>

        {/* 2. License Status */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-panel-border/60 bg-panel/40">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${license?.state === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              <KeyRound className="size-4" />
            </div>
            <div>
              <div className="text-xs text-subtle font-medium">رخصة النظام (HWID)</div>
              <div className="text-xs font-bold text-ink mt-0.5 font-mono">
                {license?.hwid ? license.hwid.slice(0, 13) + "..." : "غير معروف"}
              </div>
            </div>
          </div>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${license?.state === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
            {license?.state === "active" ? "مفعّل" : "غير مفعل"}
          </span>
        </div>

        {/* 3. System Time & Support */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-panel-border/60 bg-panel/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Clock className="size-4" />
            </div>
            <div>
              <div className="text-xs text-subtle font-medium">توقيت وساعة الجهاز</div>
              <div className="text-xs font-bold text-ink mt-0.5">
                {isTampered ? "غير متطابق (تراجع)" : "سليم ومتزامن"}
              </div>
            </div>
          </div>
          <button
            onClick={openWhatsAppSupport}
            className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-bold"
          >
            <span>الدعم</span>
            <ExternalLink className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

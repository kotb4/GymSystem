import { useEffect, useMemo, useState } from "react";
import {
  Users,
  LogOut,
  Clock,
  Search,
  AlertTriangle,
  CircleUserRound,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { describeError } from "@/utils/app-error";
import { api, type LiveOccupant } from "@/api";
import { formatTime } from "@/services/format";
import { cn } from "@/utils/cn";

interface LiveOccupantsPanelProps {
  tick?: number;
  onOccupancyChange?: (total: number) => void;
  branchId?: string;
}

export function LiveOccupantsPanel({
  tick = 0,
  onOccupancyChange,
  branchId,
}: LiveOccupantsPanelProps) {
  const t = useT();
  const { toast } = useToast();

  const [occupants, setOccupants] = useState<LiveOccupant[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);

  const loadOccupants = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.attendance.liveOccupants(branchId);
      setOccupants(res.occupants);
      setDurationMinutes(res.durationMinutes);
      onOccupancyChange?.(res.totalNow);
    } catch (err) {
      if (!silent) {
        toast("error", describeError(err, t));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial load and reload on tick or branch change
  useEffect(() => {
    void loadOccupants();
  }, [tick, branchId]);

  // Periodic refresh every 30s for live timer progression
  useEffect(() => {
    const timer = setInterval(() => {
      void loadOccupants(true);
    }, 30000);
    return () => clearInterval(timer);
  }, [branchId]);

  const handleCheckOut = async (occupant: LiveOccupant) => {
    setCheckingOutId(occupant.attendanceId);
    try {
      await api.attendance.checkOut(occupant.memberId, occupant.attendanceId);
      toast("success", `تم تسجيل خروج ${occupant.fullName} بنجاح 👋`);
      // Optimistic removal
      setOccupants((prev) => {
        const next = prev.filter((o) => o.attendanceId !== occupant.attendanceId);
        onOccupancyChange?.(next.length);
        return next;
      });
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setCheckingOutId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return occupants;
    return occupants.filter(
      (o) =>
        o.fullName.toLowerCase().includes(q) ||
        o.memberCode.toLowerCase().includes(q) ||
        (o.phone && o.phone.includes(q))
    );
  }, [occupants, search]);

  return (
    <Card className="h-full flex flex-col border-white/[0.08] bg-[#0c1017]/90 shadow-xl overflow-hidden">
      {/* Header with Occupancy Pulse */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3 bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <span className="relative flex size-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div>
            <h3 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
              <span>المتواجدون في الجيم الآن</span>
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-xs px-2 py-0.5 border border-emerald-500/30 font-bold">
                {occupants.length}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 font-medium">
              المدة الافتراضية للتمرين: <span className="font-bold text-slate-200">{durationMinutes} دقيقة</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadOccupants()}
          disabled={loading}
          title="تحديث القائمة"
          className="grid size-8 place-items-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin text-neon")} />
        </button>
      </div>

      {/* Quick Search inside Occupants */}
      {occupants.length > 0 && (
        <div className="p-3 border-b border-white/[0.06] bg-white/[0.01]">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="بحث في المتواجدين بالاسم أو الكود..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 ps-8 pe-3 rounded-lg border border-white/[0.08] bg-black/40 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-neon/50 focus:ring-1 focus:ring-neon/30"
            />
          </div>
        </div>
      )}

      {/* Occupants List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar min-h-[280px] max-h-[580px]">
        {occupants.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={<Users className="size-8 text-slate-600" />}
              title="لا يوجد متمرنون داخل الجيم حالياً"
              description="بمجرد مسح كارت أو تسجيل حضور أي عضو سيظهر فوراً هنا مع عداد وقت التمرين."
            />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-6">لا توجد نتائج مطابقة لبحثك</p>
        ) : (
          filtered.map((occ) => {
            const pct = Math.min(100, Math.round((occ.minutesElapsed / durationMinutes) * 100));
            // Format checkin time (12-hour AM/PM Arabic)
            const timePart = formatTime(occ.checkinAt);
            const isCheckingOut = checkingOutId === occ.attendanceId;

            return (
              <div
                key={occ.attendanceId}
                className={cn(
                  "group relative rounded-xl border p-3 transition-all duration-200",
                  occ.isOverdue
                    ? "border-amber-500/30 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]"
                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Photo / Avatar with Green Status Ring */}
                  <div className="relative shrink-0">
                    {occ.photoFileId ? (
                      <img
                        src={api.files.url(occ.photoFileId)}
                        alt={occ.fullName}
                        className="size-11 rounded-xl object-cover border border-white/[0.1] shadow-sm"
                      />
                    ) : (
                      <div className="grid size-11 place-items-center rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-400">
                        <CircleUserRound className="size-6" />
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full bg-emerald-500 border-2 border-[#0c1017]" />
                  </div>

                  {/* Member Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="font-bold text-xs text-white truncate">{occ.fullName}</h4>
                      <span className="font-mono text-[10px] text-slate-400 font-semibold shrink-0">
                        {occ.memberCode}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                      <span className="truncate text-slate-300 font-medium">
                        {occ.planName || "تذكرة تمرين"}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1 font-mono text-[10px] text-slate-400 shrink-0">
                        <Clock className="size-3 text-slate-500" />
                        <span>{timePart}</span>
                      </span>
                    </div>

                    {/* Progress Bar & Countdown Timer */}
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">
                          قضى <strong className="text-slate-200 font-mono">{occ.minutesElapsed}</strong> دقيقة
                        </span>
                        {occ.isOverdue ? (
                          <span className="text-amber-400 font-bold flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            <span>تجاوز الوقت (+{occ.minutesElapsed - durationMinutes} د)</span>
                          </span>
                        ) : (
                          <span className="text-emerald-400 font-medium font-mono">
                            متبقي {occ.minutesRemaining} د
                          </span>
                        )}
                      </div>

                      {/* Visual Bar */}
                      <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            occ.isOverdue
                              ? "bg-gradient-to-r from-amber-500 to-rose-500"
                              : "bg-gradient-to-r from-emerald-500 to-cyan-400"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Direct Check-Out Button */}
                  <div className="shrink-0 self-center ps-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCheckOut(occ)}
                      disabled={isCheckingOut}
                      loading={isCheckingOut}
                      title="تسجيل خروج العضو"
                      className="h-8 px-2.5 text-[11px] gap-1.5 text-rose-300 hover:text-white hover:bg-rose-500/20 border-rose-500/30 font-semibold"
                    >
                      <LogOut className="size-3.5" />
                      <span>خروج</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

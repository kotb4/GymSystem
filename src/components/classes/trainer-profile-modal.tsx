import { useEffect, useState } from "react";
import { Award, Calendar, DollarSign, Dumbbell, Mail, Phone, Users, CheckCircle2, Clock } from "lucide-react";
import { useT } from "@/i18n";
import { api, type TrainerProfile } from "@/api";
import { formatMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatMoney(minor: number): string {
  return `${formatMinor(minor)} ج.م`;
}

export function TrainerProfileModal(props: {
  open: boolean;
  onClose: () => void;
  trainerId: string | null;
}) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<TrainerProfile | null>(null);

  useEffect(() => {
    if (!props.open || !props.trainerId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    api.trainers
      .getProfile(props.trainerId)
      .then(setProfile)
      .catch((err) => console.error("Error loading trainer profile:", err))
      .finally(() => setLoading(false));
  }, [props.open, props.trainerId]);

  if (!props.open) return null;

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={profile?.trainer.fullName ?? t("trainers.profileTitle")}
      widthClass="max-w-4xl"
      footer={
        <Button variant="ghost" onClick={props.onClose}>
          {t("common.close")}
        </Button>
      }
    >
      {loading ? (
        <div className="py-12 text-center text-sm text-subtle">{t("common.loading")}</div>
      ) : !profile ? (
        <div className="py-12 text-center text-sm text-red">{t("errors.trainerNotFound")}</div>
      ) : (
        <div className="space-y-6">
          {/* Header & Basic Info Card */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/5 bg-panel p-3.5 space-y-1">
              <span className="flex items-center gap-2 text-xs text-subtle font-medium">
                <Users className="size-4 text-neon" />
                {t("trainers.traineesCount")}
              </span>
              <p className="text-xl font-bold tabnum text-fg">{profile.traineesCount}</p>
            </div>

            <div className="rounded-xl border border-white/5 bg-panel p-3.5 space-y-1">
              <span className="flex items-center gap-2 text-xs text-subtle font-medium">
                <Dumbbell className="size-4 text-cyan-400" />
                {t("trainers.completedSessions")}
              </span>
              <p className="text-xl font-bold tabnum text-fg">{profile.completedSessionsCount}</p>
            </div>

            <div className="rounded-xl border border-white/5 bg-panel p-3.5 space-y-1">
              <span className="flex items-center gap-2 text-xs text-subtle font-medium">
                <CheckCircle2 className="size-4 text-emerald-400" />
                {t("trainers.totalEarnings")}
              </span>
              <p className="text-xl font-bold tabnum text-emerald-400">
                {formatMoney(profile.totalEarningsMinor)}
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-panel p-3.5 space-y-1">
              <span className="flex items-center gap-2 text-xs text-subtle font-medium">
                <Clock className="size-4 text-amber-400" />
                {t("trainers.pendingEarnings")}
              </span>
              <p className="text-xl font-bold tabnum text-amber-400">
                {formatMoney(profile.pendingEarningsMinor)}
              </p>
            </div>
          </div>

          {/* Contact Details & Meta */}
          <div className="rounded-xl border border-white/5 bg-surface/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-fg">{profile.trainer.fullName}</span>
                {profile.trainer.rankTitle && (
                  <Badge variant="warning" className="text-xs">
                    {profile.trainer.rankTitle}
                  </Badge>
                )}
                <Badge variant={profile.trainer.isActive ? "success" : "neutral"} dot>
                  {profile.trainer.isActive ? t("status.active") : t("status.inactive")}
                </Badge>
              </div>
              {profile.trainer.defaultSessionFeeMinor > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-subtle">
                  <DollarSign className="size-3.5 text-neon" />
                  <span>{t("trainers.defaultSessionFee")}:</span>
                  <span className="font-bold tabnum text-fg">
                    {formatMoney(profile.trainer.defaultSessionFeeMinor)}
                  </span>
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-3 text-xs text-subtle">
              {profile.trainer.phone && (
                <div className="flex items-center gap-2" dir="ltr">
                  <Phone className="size-3.5 text-faint" />
                  <span>{profile.trainer.phone}</span>
                </div>
              )}
              {profile.trainer.email && (
                <div className="flex items-center gap-2" dir="ltr">
                  <Mail className="size-3.5 text-faint" />
                  <span>{profile.trainer.email}</span>
                </div>
              )}
              {profile.trainer.specialization && (
                <div className="flex items-center gap-2">
                  <Award className="size-3.5 text-faint" />
                  <span>{profile.trainer.specialization}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="size-3.5 text-faint" />
                <span>{t("trainers.joined")}: {profile.trainer.joinedDate}</span>
              </div>
            </div>

            {profile.trainer.notes && (
              <p className="text-xs text-faint border-t border-white/5 pt-2">
                {profile.trainer.notes}
              </p>
            )}
          </div>

          {/* Classes Taught */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-fg flex items-center gap-2">
              <Dumbbell className="size-4 text-neon" />
              {t("cls.tabClasses")} ({profile.classes.length})
            </h4>
            {profile.classes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-faint">
                {t("cls.emptyClasses")}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {profile.classes.map((cls) => (
                  <div key={cls.id} className="rounded-xl border border-white/5 bg-panel p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-fg">{cls.name}</span>
                      <Badge variant={cls.isActive ? "success" : "neutral"}>
                        {cls.capacity} {t("cls.person")}
                      </Badge>
                    </div>
                    {cls.planName && (
                      <div className="text-xs text-cyan-400 font-medium">
                        {cls.planName} {cls.planPrice ? `(${formatMoney(cls.planPrice)})` : ""}
                      </div>
                    )}
                    {cls.defaultTrainerFeeMinor ? (
                      <div className="text-[11px] text-faint">
                        {t("cls.trainerFee")}: {formatMoney(cls.defaultTrainerFeeMinor)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Conducted Sessions */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-fg flex items-center gap-2">
              <Calendar className="size-4 text-cyan-400" />
              {t("cls.recentSessionsTitle")} ({profile.recentSessions.length})
            </h4>
            {profile.recentSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-faint">
                {t("cls.emptySessions")}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/5 bg-panel">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-white/5 bg-surface/50 text-faint">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">{t("cls.class")}</th>
                      <th className="px-3.5 py-2.5 font-medium">{t("common.date")}</th>
                      <th className="px-3.5 py-2.5 font-medium">{t("common.time")}</th>
                      <th className="px-3.5 py-2.5 font-medium">{t("cls.attendees")}</th>
                      <th className="px-3.5 py-2.5 font-medium">{t("cls.trainerFee")}</th>
                      <th className="px-3.5 py-2.5 font-medium">{t("cls.payoutStatus")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {profile.recentSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.02]">
                        <td className="px-3.5 py-2.5 font-semibold text-fg">{s.className}</td>
                        <td className="px-3.5 py-2.5 tabnum text-subtle">{s.sessionDate}</td>
                        <td className="px-3.5 py-2.5 tabnum text-subtle" dir="ltr">{s.startTime}</td>
                        <td className="px-3.5 py-2.5 tabnum font-bold text-fg">
                          {s.attendedCount} / {s.capacity}
                        </td>
                        <td className="px-3.5 py-2.5 tabnum text-subtle">
                          {s.trainerFeeMinor ? formatMoney(s.trainerFeeMinor) : "—"}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <Badge variant={s.paidToTrainer ? "success" : "warning"}>
                            {s.paidToTrainer ? t("cls.paidToTrainer") : t("cls.pendingPayout")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

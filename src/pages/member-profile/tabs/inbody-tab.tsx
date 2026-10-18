import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicAssessment, type ProgressComparison, type FitnessResultRow } from "@/api";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Download, MessageCircle, Plus, Scale, Trash2, TrendingDown, Sparkles, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";

export function InbodyTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [assessments, setAssessments] = useState<PublicAssessment[]>([]);
  const [progress, setProgress] = useState<ProgressComparison | null>(null);
  const [fitness, setFitness] = useState<FitnessResultRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const today = todayKey();

  const [assessmentDate, setAssessmentDate] = useState(today);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPercent, setBodyFatPercent] = useState("");
  const [muscleMassKg, setMuscleMassKg] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [chestCm, setChestCm] = useState("");
  const [armCm, setArmCm] = useState("");
  const [thighCm, setThighCm] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let alive = true;
    void (async () => {
      try {
        const items = await api.inbody.list(ctx.member.id, 100);
        if (alive) setAssessments(items);
      } catch { /* ignore */ }
      try {
        const p = await api.inbody.progress(ctx.member.id);
        if (alive) setProgress(p);
      } catch { /* ignore */ }
      try {
        const fr = await api.inbody.listResults({ memberId: ctx.member.id } as never);
        if (alive) setFitness(fr as FitnessResultRow[]);
      } catch { /* ignore */ }
    })();
    return () => {
      alive = false;
    };
  }, [ctx.member.id]);

  useEffect(() => {
    reload();
  }, [reload, ctx.reloadTick]);

  if (!hasPermission("assessments.view")) {
    return permissionDeniedNode(t);
  }

  const resetForm = () => {
    setAssessmentDate(today);
    setHeightCm("");
    setWeightKg("");
    setBodyFatPercent("");
    setMuscleMassKg("");
    setWaistCm("");
    setChestCm("");
    setArmCm("");
    setThighCm("");
    setNotes("");
    setError(null);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.inbody.createAssessment({
        memberId: ctx.member.id,
        assessmentDate,
        heightCm: heightCm ? Number(heightCm) : null,
        weightKg: weightKg ? Number(weightKg) : null,
        bodyFatPercent: bodyFatPercent ? Number(bodyFatPercent) : null,
        muscleMassKg: muscleMassKg ? Number(muscleMassKg) : null,
        waistCm: waistCm ? Number(waistCm) : null,
        chestCm: chestCm ? Number(chestCm) : null,
        armCm: armCm ? Number(armCm) : null,
        thighCm: thighCm ? Number(thighCm) : null,
        notes: notes || null,
      });
      toast("success", t("inbody.savedToast"));
      resetForm();
      setShowForm(false);
      reload();
      ctx.reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await api.inbody.deleteAssessment(deleteTarget);
      toast("success", t("inbody.deletedToast"));
      setDeleteTarget(null);
      reload();
      ctx.reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const sorted = [...assessments].sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate));
  const deltaWeight = progress?.deltas.find((d) => d.field === "weightKg");
  const deltaBmi = progress?.deltas.find((d) => d.field === "bmi");
  const deltaBodyFat = progress?.deltas.find((d) => d.field === "bodyFatPercent");
  const deltaMuscle = progress?.deltas.find((d) => d.field === "muscleMassKg");
  const hasDeltas = Boolean(progress && progress.latest && progress.previous);

  const onShareWhatsApp = (row: PublicAssessment) => {
    const lines = [
      `📊 *تقرير قياس InBody البدني*`,
      `👤 *العضو:* ${ctx.member.fullName}`,
      `📅 *تاريخ الفحص:* ${row.assessmentDate}`,
      row.weightKg != null ? `⚖️ *الوزن:* ${row.weightKg} كجم` : null,
      row.bodyFatPercent != null ? `🔥 *نسبة الدهون:* ${row.bodyFatPercent}%` : null,
      row.muscleMassKg != null ? `💪 *الكتلة العضلية:* ${row.muscleMassKg} كجم` : null,
      row.bmi != null ? `📈 *مؤشر كتلة الجسم (BMI):* ${row.bmi}` : null,
      row.waistCm != null ? `📏 *محيط الوسط:* ${row.waistCm} سم` : null,
      row.chestCm != null ? `📏 *محيط الصدر:* ${row.chestCm} سم` : null,
      row.armCm != null ? `📏 *محيط الذراع:* ${row.armCm} سم` : null,
      row.thighCm != null ? `📏 *محيط الفخذ:* ${row.thighCm} سم` : null,
      row.notes ? `📝 *ملاحظات الكابتن:* ${row.notes}` : null,
      `\nعاش يا بطل! واصل الالتزام والتطور نحو هدفك 🚀💪`,
    ].filter(Boolean);

    const text = lines.join("\n");
    const url = buildWhatsAppDirectUrl(ctx.member.phone, text);
    if (url) {
      window.open(url, "_blank");
    } else {
      toast("warning", "رقم هاتف العضو غير مسجل أو غير صالح للواتساب");
    }
  };

  const onExportAssessments = () => {
    if (sorted.length === 0) {
      toast("info", t("inbody.empty"));
      return;
    }
    const headers = [
      t("common.date"),
      t("members.formWeight"),
      "BMI",
      t("inbody.bodyFat"),
      t("inbody.muscleMass"),
      t("inbody.waist"),
      t("inbody.chest"),
      t("inbody.arm"),
      t("inbody.thigh"),
      t("members.notes"),
    ];
    const dataRows = sorted.map((r) => [
      r.assessmentDate,
      r.weightKg != null ? String(r.weightKg) : "—",
      r.bmi != null ? String(r.bmi) : "—",
      r.bodyFatPercent != null ? String(r.bodyFatPercent) : "—",
      r.muscleMassKg != null ? String(r.muscleMassKg) : "—",
      r.waistCm != null ? String(r.waistCm) : "—",
      r.chestCm != null ? String(r.chestCm) : "—",
      r.armCm != null ? String(r.armCm) : "—",
      r.thighCm != null ? String(r.thighCm) : "—",
      r.notes ?? "",
    ]);
    downloadCsvWithBom(`قياسات_InBody_${ctx.member.fullName}_${today}`, headers, dataRows);
    toast("success", t("inbody.exportSuccess"));
  };

  const assessCols: Column<PublicAssessment>[] = [
    {
      key: "date",
      header: t("common.date"),
      render: (row) => <span dir="ltr" className="tabnum text-subtle font-bold">{row.assessmentDate}</span>,
    },
    {
      key: "weight",
      header: t("members.formWeight"),
      render: (row) => <span className="tabnum font-extrabold">{row.weightKg != null ? `${row.weightKg} كجم` : "—"}</span>,
    },
    {
      key: "bmi",
      header: "BMI",
      render: (row) => <span className="tabnum">{row.bmi ?? "—"}</span>,
    },
    {
      key: "bodyFat",
      header: t("inbody.bodyFat"),
      render: (row) => (
        <span className="tabnum font-bold text-amber">
          {row.bodyFatPercent != null ? `${row.bodyFatPercent}%` : "—"}
        </span>
      ),
    },
    {
      key: "muscleMass",
      header: t("inbody.muscleMass"),
      render: (row) => (
        <span className="tabnum font-bold text-neon">
          {row.muscleMassKg != null ? `${row.muscleMassKg} كجم` : "—"}
        </span>
      ),
    },
    {
      key: "waist",
      header: t("inbody.waist"),
      render: (row) => <span className="tabnum text-subtle">{row.waistCm != null ? `${row.waistCm} سم` : "—"}</span>,
    },
    {
      key: "notes",
      header: t("members.notes"),
      render: (row) => <span className="truncate text-faint max-w-xs">{row.notes ?? "—"}</span>,
    },
    {
      key: "actions",
      header: t("common.actions"),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onShareWhatsApp(row)}
            title={t("inbody.shareWhatsApp")}
            className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
          >
            <MessageCircle className="size-3.5" />
          </Button>
          {hasPermission("assessments.manage") && ctx.member.status !== "archived" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleteTarget(row.id)}
              className="text-red hover:bg-red/10"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 4 Professional Physical Evolution KPI Stat Cards */}
      {hasDeltas ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t("members.formWeight")}
            subtitle={
              deltaWeight?.delta != null
                ? `${deltaWeight.delta > 0 ? "+" : ""}${deltaWeight.delta.toFixed(1)} كجم عن القياس السابق`
                : "—"
            }
            value={progress?.latest?.weightKg != null ? `${progress.latest.weightKg} كجم` : "—"}
            icon={<Scale className="size-5" />}
            accent="cyan"
          />
          <StatCard
            title={t("inbody.bodyFat")}
            subtitle={
              deltaBodyFat?.delta != null
                ? `${deltaBodyFat.delta > 0 ? "+" : ""}${deltaBodyFat.delta.toFixed(1)}% فارق الدهون`
                : "—"
            }
            value={progress?.latest?.bodyFatPercent != null ? `${progress.latest.bodyFatPercent}%` : "—"}
            icon={<TrendingDown className="size-5" />}
            accent="amber"
          />
          <StatCard
            title={t("inbody.muscleMass")}
            subtitle={
              deltaMuscle?.delta != null
                ? `${deltaMuscle.delta > 0 ? "+" : ""}${deltaMuscle.delta.toFixed(1)} كجم كتلة عضلية`
                : "—"
            }
            value={progress?.latest?.muscleMassKg != null ? `${progress.latest.muscleMassKg} كجم` : "—"}
            icon={<Sparkles className="size-5" />}
            accent="neon"
          />
          <StatCard
            title="مؤشر كتلة الجسم (BMI)"
            subtitle={
              deltaBmi?.delta != null
                ? `${deltaBmi.delta > 0 ? "+" : ""}${deltaBmi.delta.toFixed(1)} فارق المؤشر`
                : "—"
            }
            value={progress?.latest?.bmi != null ? `${progress.latest.bmi}` : "—"}
            icon={<Activity className="size-5" />}
            accent="violet"
          />
        </div>
      ) : null}

      {hasPermission("assessments.manage") && ctx.member.status !== "archived" && (
        <Card>
          <CardHeader
            title={t("inbody.addAssessment")}
            action={
              <Button variant="secondary" onClick={() => { setShowForm(!showForm); resetForm(); }}>
                <Plus className="size-4" />
                {showForm ? t("common.cancel") : t("inbody.addAssessment")}
              </Button>
            }
          />
          {showForm && (
            <form
              onSubmit={(e) => { e.preventDefault(); void onSubmit(); }}
              noValidate
              className="space-y-3.5 px-5 pb-5"
            >
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input label={t("common.date")} type="date" dir="ltr" value={assessmentDate} onChange={(e) => setAssessmentDate(e.target.value)} disabled={submitting} />
                <Input label={t("members.formHeight")} type="number" dir="ltr" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} disabled={submitting} />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input label={t("members.formWeight")} type="number" dir="ltr" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.bodyFat")} type="number" dir="ltr" step="0.1" value={bodyFatPercent} onChange={(e) => setBodyFatPercent(e.target.value)} disabled={submitting} />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input label={t("inbody.muscleMass")} type="number" dir="ltr" step="0.1" value={muscleMassKg} onChange={(e) => setMuscleMassKg(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.waist")} type="number" dir="ltr" step="0.1" value={waistCm} onChange={(e) => setWaistCm(e.target.value)} disabled={submitting} />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-3">
                <Input label={t("inbody.chest")} type="number" dir="ltr" step="0.1" value={chestCm} onChange={(e) => setChestCm(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.arm")} type="number" dir="ltr" step="0.1" value={armCm} onChange={(e) => setArmCm(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.thigh")} type="number" dir="ltr" step="0.1" value={thighCm} onChange={(e) => setThighCm(e.target.value)} disabled={submitting} />
              </div>
              <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
              {error && (
                <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">{error}</p>
              )}
              <div className="flex items-center gap-2">
                <Button type="submit" loading={submitting} disabled={submitting}>{t("common.save")}</Button>
                <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }} disabled={submitting}>{t("common.cancel")}</Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-0">
          <h3 className="text-base font-extrabold">{t("inbody.history")}</h3>
          {sorted.length > 0 && (
            <Button variant="secondary" size="sm" onClick={onExportAssessments}>
              <Download className="size-3.5" />
              {t("inbody.exportHistory")}
            </Button>
          )}
        </div>
        <div className="p-5 pt-3">
          {sorted.length === 0 ? (
            <EmptyState icon={<Scale />} title={t("inbody.empty")} />
          ) : (
            <DataTable columns={assessCols} data={sorted} rowKey={(r) => r.id} />
          )}
        </div>
      </Card>

      {fitness.length > 0 && (
        <Card>
          <CardHeader title={t("inbody.fitnessTests")} />
          <ul className="divide-y divide-line px-5 pb-4">
            {fitness.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-bold">{f.defName}</span>
                <span dir="ltr" className="tabnum font-bold text-neon">{f.value} {f.unit}</span>
                <span dir="ltr" className="tabnum text-faint">{f.testDate}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("inbody.deleteMeasurement")}
        message={t("inbody.deleteConfirm")}
        onConfirm={onDeleteConfirm}
      />
    </div>
  );
}

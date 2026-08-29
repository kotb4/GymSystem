import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicAssessment, type ProgressComparison, type FitnessResultRow } from "@/api";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Plus, Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

export function InbodyTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [assessments, setAssessments] = useState<PublicAssessment[]>([]);
  const [progress, setProgress] = useState<ProgressComparison | null>(null);
  const [fitness, setFitness] = useState<FitnessResultRow[]>([]);
  const [showForm, setShowForm] = useState(false);
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
      toast("success", t("toast.saved"));
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

  const sorted = [...assessments].sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate));
  const deltaWeight = progress?.deltas.find((d) => d.field === "weightKg");
  const deltaBmi = progress?.deltas.find((d) => d.field === "bmi");
  const deltaBodyFat = progress?.deltas.find((d) => d.field === "bodyFatPercent");
  const hasDeltas = progress && progress.latest && progress.previous;

  const assessCols: Column<PublicAssessment>[] = [
    {
      key: "date",
      header: t("common.date"),
      render: (row) => <span dir="ltr" className="tabnum text-subtle">{row.assessmentDate}</span>,
    },
    {
      key: "weight",
      header: t("members.formWeight"),
      render: (row) => <span className="tabnum">{row.weightKg ?? "—"}</span>,
    },
    {
      key: "bmi",
      header: "BMI",
      render: (row) => <span className="tabnum">{row.bmi ?? "—"}</span>,
    },
    {
      key: "bodyFat",
      header: t("inbody.bodyFat"),
      render: (row) => <span className="tabnum">{row.bodyFatPercent != null ? `${row.bodyFatPercent}%` : "—"}</span>,
    },
    {
      key: "muscleMass",
      header: t("inbody.muscleMass"),
      render: (row) => <span className="tabnum">{row.muscleMassKg ?? "—"}</span>,
    },
    {
      key: "notes",
      header: t("members.notes"),
      render: (row) => <span className="truncate text-faint">{row.notes ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {hasDeltas && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><div className="p-4 text-center"><p className="text-xs font-semibold text-faint">{t("members.formWeight")}</p><p className="mt-1 text-lg font-extrabold tabnum">{deltaWeight?.delta != null ? `${deltaWeight.delta > 0 ? "+" : ""}${deltaWeight.delta.toFixed(1)}` : "—"}</p></div></Card>
          <Card><div className="p-4 text-center"><p className="text-xs font-semibold text-faint">BMI</p><p className="mt-1 text-lg font-extrabold tabnum">{deltaBmi?.delta != null ? `${deltaBmi.delta > 0 ? "+" : ""}${deltaBmi.delta.toFixed(1)}` : "—"}</p></div></Card>
          <Card><div className="p-4 text-center"><p className="text-xs font-semibold text-faint">{t("inbody.bodyFat")}</p><p className="mt-1 text-lg font-extrabold tabnum">{deltaBodyFat?.delta != null ? `${deltaBodyFat.delta > 0 ? "+" : ""}${deltaBodyFat.delta.toFixed(1)}%` : "—"}</p></div></Card>
        </div>
      )}
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
        <CardHeader title={t("inbody.history")} />
        {sorted.length === 0 ? (
          <EmptyState icon={<Scale />} title={t("inbody.empty")} />
        ) : (
          <DataTable columns={assessCols} data={sorted} rowKey={(r) => r.id} />
        )}
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
    </div>
  );
}

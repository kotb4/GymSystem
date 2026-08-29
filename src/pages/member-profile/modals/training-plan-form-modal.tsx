import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, rpc } from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import type { PublicTrainer } from "@/core/services/trainers.service";
import { todayKey } from "@/core/dates";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface TrainingPlanFormModalProps {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  onSaved: () => void;
}

export function TrainingPlanFormModal({ open, onClose, member, onSaved }: TrainingPlanFormModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const today = todayKey();

  const [trainerOptions, setTrainerOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [trainerId, setTrainerId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !actor) return;
    let alive = true;
    api.trainers
      .list({ activeOnly: true })
      .then((trainers) => {
        if (!alive) return;
        const options = (trainers as PublicTrainer[]).map((tr) => ({
          value: tr.id,
          label: tr.fullName,
        }));
        setTrainerOptions(options);
        setTrainerId(options[0]?.value ?? "");
      })
      .catch((err) => console.error(err));
    setStartDate(today);
    setEndDate("");
    setNotes("");
    setError(null);
    return () => {
      alive = false;
    };
  }, [open, actor, today]);

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await rpc("trainingPlans", "createTrainingPlan", [{
        memberId: member.id,
        trainerId,
        startDate,
        endDate,
        notes: notes || null,
      } as never]);
      toast("success", t("trainers.savedToast"));
      onSaved();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("trainers.planAddTitle", { name: member.fullName })} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <Select
          label={t("nav.trainers")}
          value={trainerId}
          onChange={(e) => setTrainerId(e.target.value)}
          options={trainerOptions}
          disabled={submitting}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input label={t("rpt.from")} type="date" dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={submitting} />
          <Input label={t("rpt.to")} type="date" dir="ltr" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={submitting} />
        </div>
        <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting} disabled={submitting || trainerOptions.length === 0}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicTrainer } from "@/api";
import { todayKey } from "@/core/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function TrainerFormModal(props: {
  open: boolean;
  onClose: () => void;
  target: PublicTrainer | null;
  onSaved: () => void;
}) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [joinedDate, setJoinedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setFullName(props.target?.fullName ?? "");
    setPhone(props.target?.phone ?? "");
    setEmail(props.target?.email ?? "");
    setSpecialization(props.target?.specialization ?? "");
    setJoinedDate(props.target?.joinedDate ?? todayKey());
    setNotes(props.target?.notes ?? "");
  }, [props.open, props.target]);

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        fullName,
        phone: phone || null,
        email: email || null,
        specialization: specialization || null,
        joinedDate,
        notes: notes || null,
      };
      if (props.target) {
        await api.trainers.update(props.target.id, input);
      } else {
        await api.trainers.create(input);
      }
      toast("success", t("trainers.savedToast"));
      props.onSaved();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.target ? t("trainers.editTitle") : t("trainers.addTitle")}
      widthClass="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} loading={submitting} disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
      >
        <Input
          label={t("common.name")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          disabled={submitting}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("members.phone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            disabled={submitting}
          />
          <Input
            label={t("users.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            disabled={submitting}
          />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("trainers.specialization")}
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={t("trainers.joined")}
            type="date"
            value={joinedDate}
            onChange={(e) => setJoinedDate(e.target.value)}
            dir="ltr"
            disabled={submitting}
          />
        </div>
        <Input
          label={t("members.notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
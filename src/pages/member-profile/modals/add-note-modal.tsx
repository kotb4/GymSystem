import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface AddNoteModalProps {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  onSaved: () => void;
}

export function AddNoteModal({ open, onClose, member, onSaved }: AddNoteModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState(member.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.members.update(member.id, { notes: notes.trim() || null } as never);
      toast("success", t("members.notesSaved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("members.qaAddNote")} widthClass="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <p className="text-[12px] text-faint">{t("members.profileTitle")}: {member.fullName}</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("members.notesPlaceholder")}
          rows={6}
          className="flex w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm transition-colors focus:border-neon focus:outline-none"
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting} disabled={submitting}>
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

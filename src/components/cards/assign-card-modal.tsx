import { useEffect, useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { BarcodeField } from "@/components/ui/barcode-field";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

interface AssignCardModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  presetMember?: PublicMember | null;
}

export function AssignCardModal({ open, onClose, onDone, presetMember }: AssignCardModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [barcode, setBarcode] = useState("");
  const [selected, setSelected] = useState<PublicMember | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(presetMember ?? null);
    setError(null);
    try {
      void api.cards.nextBarcodePreview().then(setBarcode);
    } catch {
      setBarcode("");
    }
  }, [open, presetMember]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.cards.assignByBarcode({ barcodeValue: barcode, memberId: selected.id });
      toast("success", `${t("cards.assignedToast")}: ${selected.fullName}`);
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={presetMember ? t("members.assignCardTo") : t("cards.assign")}
        footer={
          <>
            <Button type="submit" form="assign-card-form" loading={submitting} disabled={submitting || !selected}>
              {t("common.confirm")}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <form id="assign-card-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <BarcodeField
            label={t("cards.barcode")}
            value={barcode}
            onValueChange={setBarcode}
            disabled={submitting}
            autoFocus={!presetMember}
          />
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold text-subtle">{t("common.member")}</p>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={submitting}
              className="flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-panel px-3.5 text-start text-sm transition-colors hover:border-neon/50 disabled:opacity-50"
            >
              {selected ? (
                <span className="min-w-0 flex-1 truncate">{selected.fullName}</span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-faint">{t("subs.pickMember")}</span>
              )}
              <UserRound className="size-4 shrink-0 text-faint" />
            </button>
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
              {error}
            </p>
          )}
        </form>
      </Modal>
      <MemberPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setSelected} />
    </>
  );
}

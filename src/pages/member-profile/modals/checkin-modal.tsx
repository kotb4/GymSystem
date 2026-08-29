import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { CardWithMember } from "@/core/services/cards.service";
import type { PublicMember } from "@/core/services/members.service";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface CheckinModalProps {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  onChecked: () => void;
}

export function CheckinModal({ open, onClose, member, onChecked }: CheckinModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [cards, setCards] = useState<CardWithMember[]>([]);
  const [barcode, setBarcode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !actor) return;
    let alive = true;
    api.cards
      .listForMember(member.id)
      .then((rows) => {
        if (!alive) return;
        const typed = (rows as CardWithMember[]).filter(
          (c) => c.status === "assigned" || c.status === "available",
        );
        setCards(typed);
        const first = typed[0];
        if (first) setBarcode(first.barcodeValue);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, actor, member.id]);

  const onSubmit = async () => {
    if (!actor) return;
    if (!barcode.trim()) {
      setError(t("errors.invalidBarcode"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = (await api.attendance.checkIn({ barcode: barcode.trim() })) as {
        kind?: string;
        reason?: string;
        memberName?: string;
      };
      if (result?.kind === "denied" || result?.kind === "duplicate") {
        const reason = result.reason ?? "UNKNOWN";
        setError(t(`checkin.deniedTitles.${reason}` as never));
        return;
      }
      toast("success", t("checkin.successTitle", { name: member.fullName }));
      onChecked();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("members.qaCheckin")} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <p className="text-[12px] text-faint">{t("members.profileTitle")}: {member.fullName}</p>
        {cards.length > 0 ? (
          <Select
            label={t("cards.barcode")}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            options={cards.map((c) => ({ value: c.barcodeValue, label: c.barcodeValue }))}
            disabled={submitting}
          />
        ) : (
          <p className="text-[12px] text-amber">{t("cards.noAssigned")}</p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting} disabled={submitting || !barcode}>
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

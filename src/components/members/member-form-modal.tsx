import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicMember } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface MemberFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (member: PublicMember) => void;
  member?: PublicMember | null;
}

export function MemberFormModal({ open, onClose, onSaved, member }: MemberFormModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [department, setDepartment] = useState("general");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName(member?.fullName ?? "");
    setPhone(member?.phone ?? "");
    setEmail(member?.email ?? "");
    setGender(member?.gender ?? "");
    setDateOfBirth(member?.dateOfBirth ?? "");
    setAddress(member?.address ?? "");
    setHeightCm(member?.heightCm == null ? "" : String(member.heightCm));
    setWeightKg(member?.weightKg == null ? "" : String(member.weightKg));
    setEmergencyContactName(member?.emergencyContactName ?? "");
    setEmergencyContactPhone(member?.emergencyContactPhone ?? "");
    setDepartment(member?.department ?? "general");
    setNotes(member?.notes ?? "");
    setError(null);
  }, [open, member]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        fullName,
        phone: phone.trim() || null,
        email: email.trim() || null,
        gender: gender === "" ? null : (gender as "male" | "female"),
        dateOfBirth: dateOfBirth || null,
        address: address.trim() || null,
        heightCm: heightCm.trim() === "" ? null : Number(heightCm),
        weightKg: weightKg.trim() === "" ? null : Number(weightKg),
        emergencyContactName: emergencyContactName.trim() || null,
        emergencyContactPhone: emergencyContactPhone.trim() || null,
        department: department as "general" | "men" | "women",
        notes: notes.trim() || null,
      };
      const saved = member
        ? await api.members.update(member.id, input)
        : await api.members.create(input);
      toast("success", t("toast.saved"));
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? t("members.editMember") : t("members.addMember")}
      widthClass="max-w-lg"
      footer={
        <>
          <Button type="submit" form="member-form" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={onSubmit} noValidate className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("members.formName")}
            placeholder={t("members.formNamePh")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          <Input
            label={`${t("members.formPhone")} (${t("common.optional")})`}
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={`${t("members.formEmail")} (${t("common.optional")})`}
            dir="ltr"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          <Select
            label={t("members.formGender")}
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            disabled={submitting}
            options={[
              { value: "", label: "—" },
              { value: "male", label: t("members.male") },
              { value: "female", label: t("members.female") },
            ]}
          />
          <Input
            label={`${t("members.formDob")} (${t("common.optional")})`}
            type="date"
            dir="ltr"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={`${t("members.formAddress")} (${t("common.optional")})`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={`${t("members.formHeight")} (${t("common.optional")})`}
            dir="ltr"
            type="number"
            step="0.1"
            min="50"
            max="280"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={`${t("members.formWeight")} (${t("common.optional")})`}
            dir="ltr"
            type="number"
            step="0.1"
            min="10"
            max="500"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={`${t("members.formEmergencyName")} (${t("common.optional")})`}
            value={emergencyContactName}
            onChange={(e) => setEmergencyContactName(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={`${t("members.formEmergencyPhone")} (${t("common.optional")})`}
            dir="ltr"
            value={emergencyContactPhone}
            onChange={(e) => setEmergencyContactPhone(e.target.value)}
            disabled={submitting}
          />
          <Select
            label={t("members.department")}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={submitting}
            options={[
              { value: "general", label: t("members.deptGeneral") },
              { value: "men", label: t("members.deptMen") },
              { value: "women", label: t("members.deptWomen") },
            ]}
          />
        </div>
        <Input
          label={`${t("members.formNotes")} (${t("common.optional")})`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

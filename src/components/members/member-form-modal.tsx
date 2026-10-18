import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Image as ImageIcon, Send, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicMember } from "@/api";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar } from "@/components/ui/avatar";
import { CameraCapture } from "@/components/ui/camera-capture";
import { compressMemberPhoto } from "@/utils/image-compressor";

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
  const [homeBranchOnly, setHomeBranchOnly] = useState(false);
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setHomeBranchOnly(member?.homeBranchOnly ?? false);
    setNotes(member?.notes ?? "");
    setPhotoFile(null);
    setPhotoRemoved(false);
    setCameraOpen(false);
    setPhotoPreview(member?.photoFileId ? api.files.url(member.photoFileId) : null);
    setError(null);
  }, [open, member]);

  const onSubmit = async (e?: FormEvent, sendWelcome = false) => {
    if (e) e.preventDefault();
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
        homeBranchOnly,
        notes: notes.trim() || null,
      };
      const saved = member
        ? await api.members.update(member.id, input)
        : await api.members.create(input);

      let finalMember = saved;
      if (photoFile) {
        try {
          const { id: fileId } = await api.files.upload("member_photo", photoFile);
          finalMember = await api.members.setMemberPhoto(saved.id, fileId);
        } catch (uploadErr) {
          console.error("Photo upload error:", uploadErr);
        }
      } else if (photoRemoved && member?.photoFileId) {
        try {
          finalMember = await api.members.removeMemberPhoto(saved.id);
        } catch (removeErr) {
          console.error("Photo remove error:", removeErr);
        }
      }

      if (sendWelcome && !member && finalMember.phone) {
        let sentDirectly = false;
        try {
          const res = await api.messages.sendWelcomeMessage(finalMember.id);
          if (res && res.status === "sent") {
            sentDirectly = true;
            toast("success", "تم حفظ العضو وإرسال رسالة الترحيب والـ QR عبر الواتساب تلقائياً! ✅");
          }
        } catch (msgErr) {
          console.error("Auto welcome send error:", msgErr);
        }

        if (!sentDirectly) {
          try {
            let portalUrl = "";
            try {
              const portal = await api.memberPortal.getUrl(finalMember.id);
              if (portal?.url) portalUrl = portal.url;
            } catch {}

            const welcomeText = [
              `👋 أهلاً بك يا ${finalMember.fullName} في النادي!`,
              `🆔 كود العضوية الخاص بك: ${finalMember.memberCode}`,
              portalUrl ? `📲 رابط حسابك وبطاقتك الإلكترونية:\n${portalUrl}` : null,
              `نتمنى لك رحلة تدريبية موفقة معنا! 💪✨`,
              `Powered by GymGate — KOTB Digital Solutions`,
            ]
              .filter(Boolean)
              .join("\n\n");

            const waUrl = buildWhatsAppDirectUrl(finalMember.phone, welcomeText);
            if (waUrl) {
              window.open(waUrl, "_blank");
              toast("info", "تم حفظ العضو وفتح واتساب لإرسال رسالة الترحيب لعدم اتصال البوابة المحلية");
            } else {
              toast("success", t("toast.saved"));
            }
          } catch {
            toast("success", t("toast.saved"));
          }
        }
      } else {
        toast("success", t("toast.saved"));
      }

      onSaved(finalMember);
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
          {!member && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!phone.trim()) {
                  toast("error", "يرجى كتابة رقم الهاتف لإرسال رسالة الترحيب عبر الواتساب");
                  return;
                }
                void onSubmit(undefined, true);
              }}
              loading={submitting}
              disabled={submitting || !fullName.trim()}
              className="text-emerald-400 hover:text-emerald-300 border-emerald-500/30 gap-1.5"
              title="حفظ العضو وإرسال رسالة الترحيب والباركود عبر الواتساب"
            >
              <Send className="size-3.5" />
              <span>{t("members.saveAndSend")}</span>
            </Button>
          )}
          <Button type="submit" form="member-form" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {/* Photo capture & upload row */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface/60 p-3.5">
          <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-inner">
            {photoPreview ? (
              <img
                src={photoPreview}
                alt={fullName || "member"}
                className="h-full w-full object-cover"
              />
            ) : (
              <Avatar name={fullName || "عضو"} size="md" className="h-full w-full rounded-2xl text-base" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block text-xs font-bold text-subtle">{t("members.formPhoto")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setCameraOpen(true)}
                disabled={submitting}
              >
                <Camera className="size-3.5" />
                {t("members.formPhotoCamera")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                <ImageIcon className="size-3.5" />
                {t("members.photoUpload")}
              </Button>
              {photoPreview && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreview(null);
                    setPhotoRemoved(true);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={submitting}
                  className="text-red hover:bg-red/10"
                >
                  <X className="size-3.5" />
                  {t("members.photoRemove")}
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                const compressed = await compressMemberPhoto(f, { maxDimension: 512, quality: 0.82 });
                setPhotoFile(compressed);
                setPhotoPreview(URL.createObjectURL(compressed));
                setPhotoRemoved(false);
              }
            }}
          />
        </div>

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
        <div className="rounded-xl border border-line bg-surface/50 p-3.5 space-y-1">
          <Checkbox
            checked={homeBranchOnly}
            onCheckedChange={setHomeBranchOnly}
            disabled={submitting}
          >
            <span className="font-bold text-foreground text-sm">{t("members.homeBranchOnly")}</span>
          </Checkbox>
          <p className="text-xs text-subtle ms-6">
            {t("members.homeBranchOnlyDesc")}
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>

      {cameraOpen && (
        <CameraCapture
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setPhotoFile(file);
            setPhotoPreview(URL.createObjectURL(file));
            setPhotoRemoved(false);
            setCameraOpen(false);
          }}
        />
      )}
    </Modal>
  );
}

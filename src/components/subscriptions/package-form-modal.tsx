import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type AccessArea, type Package, type PackageModel } from "@/api";
import { toMinor, minorToMajor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface PackageFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  pkg?: Package | null;
}

const ALL_AREAS: AccessArea[] = ["general", "men", "women"];

export function PackageFormModal({ open, onClose, onSaved, pkg }: PackageFormModalProps) {
  const t = useT();
  const actor = useAuth().actor;
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [model, setModel] = useState<PackageModel>("time");
  const [durationDays, setDurationDays] = useState("30");
  const [price, setPrice] = useState("");
  const [visitLimit, setVisitLimit] = useState("");
  const [unlimitedVisits, setUnlimitedVisits] = useState(false);
  const [freezeAllowanceDays, setFreezeAllowanceDays] = useState("0");
  const [allowedFreezes, setAllowedFreezes] = useState("0");
  const [ptSessions, setPtSessions] = useState("0");
  const [allowedAreas, setAllowedAreas] = useState<AccessArea[]>(["general"]);
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(pkg?.name ?? "");
    setModel(pkg?.model ?? "time");
    setDurationDays(pkg ? String(pkg.durationDays) : "30");
    setPrice(pkg ? String(minorToMajor(pkg.price)) : "");
    setVisitLimit(pkg?.visitLimit != null ? String(pkg.visitLimit) : "");
    setUnlimitedVisits(pkg?.unlimitedVisits ?? false);
    setFreezeAllowanceDays(pkg ? String(pkg.freezeAllowanceDays) : "0");
    setAllowedFreezes(pkg ? String(pkg.allowedFreezes) : "0");
    setPtSessions(pkg ? String(pkg.ptSessions) : "0");
    setAllowedAreas(pkg && pkg.allowedAreas.length ? pkg.allowedAreas : ["general"]);
    setDescription(pkg?.description ?? "");
    setIsActive(pkg ? pkg.isActive : true);
    setError(null);
  }, [open, pkg]);

  const toggleArea = (a: AccessArea) => {
    setAllowedAreas((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    const input = {
      name,
      model,
      durationDays: Number(durationDays),
      price: toMinor(price || "0"),
      visitLimit: unlimitedVisits ? null : visitLimit === "" ? undefined : Number(visitLimit),
      unlimitedVisits,
      freezeAllowanceDays: Number(freezeAllowanceDays || "0"),
      allowedFreezes: Number(allowedFreezes || "0"),
      ptSessions: Number(ptSessions || "0"),
      allowedAreas,
      description: description.trim() || null,
    };
    setSubmitting(true);
    setError(null);
    try {
      if (pkg) {
        await api.packages.update(pkg.id, { ...input, isActive });
      } else {
        await api.packages.create(input);
      }
      toast("success", pkg ? t("packages.updatedToast") : t("packages.createdToast"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const needsVisits = (model === "visit" || model === "hybrid") && !unlimitedVisits;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pkg ? t("packages.editPackage") : t("packages.addPackage")}
      footer={
        <>
          <Button type="submit" form="package-form" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="package-form" onSubmit={onSubmit} noValidate className="space-y-3.5">
        <Input
          label={t("packages.name")}
          placeholder={t("packages.namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          autoFocus
        />
        <Select
          label={t("packages.model")}
          value={model}
          onChange={(e) => setModel(e.target.value as PackageModel)}
          options={[
            { value: "time", label: t("packages.modelTime") },
            { value: "visit", label: t("packages.modelVisit") },
            { value: "hybrid", label: t("packages.modelHybrid") },
          ]}
          disabled={submitting}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("packages.durationDays")}
            type="number"
            min={1}
            dir="ltr"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={t("packages.price")}
            type="text"
            inputMode="decimal"
            dir="ltr"
            placeholder={t("packages.pricePh")}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={submitting}
          />
        </div>
        {(model === "visit" || model === "hybrid") && (
          <div className="space-y-3.5">
            <Checkbox checked={unlimitedVisits} onCheckedChange={setUnlimitedVisits} disabled={submitting}>
              {t("packages.unlimitedVisits")}
            </Checkbox>
            {needsVisits && (
              <Input
                label={t("packages.visitLimit")}
                type="number"
                min={1}
                dir="ltr"
                value={visitLimit}
                onChange={(e) => setVisitLimit(e.target.value)}
                disabled={submitting}
              />
            )}
          </div>
        )}
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Input
            label={t("packages.freezeAllowanceDays")}
            type="number"
            min={0}
            dir="ltr"
            value={freezeAllowanceDays}
            onChange={(e) => setFreezeAllowanceDays(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={t("packages.allowedFreezes")}
            type="number"
            min={0}
            dir="ltr"
            value={allowedFreezes}
            onChange={(e) => setAllowedFreezes(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={t("packages.ptSessions")}
            type="number"
            min={0}
            dir="ltr"
            value={ptSessions}
            onChange={(e) => setPtSessions(e.target.value)}
            disabled={submitting}
          />
        </div>
        <fieldset>
          <legend className="mb-2 block text-[13px] font-semibold text-subtle">{t("packages.allowedAreas")}</legend>
          <div className="flex flex-wrap gap-4">
            {ALL_AREAS.map((a) => (
              <Checkbox key={a} checked={allowedAreas.includes(a)} onCheckedChange={() => toggleArea(a)} disabled={submitting}>
                {t(`packages.area${a.charAt(0).toUpperCase()}${a.slice(1)}`)}
              </Checkbox>
            ))}
          </div>
        </fieldset>
        <Input
          label={`${t("common.notes")} (${t("common.optional")})`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
        {pkg && (
          <Checkbox checked={isActive} onCheckedChange={setIsActive} disabled={submitting}>
            {t("packages.active")}
          </Checkbox>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

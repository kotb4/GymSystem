import { useState } from "react";
import { Sparkles, Layers } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AutoGenerateCardsModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function AutoGenerateCardsModal({ open, onClose, onDone }: AutoGenerateCardsModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [count, setCount] = useState<number>(50);
  const [prefix, setPrefix] = useState<string>("GYM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [20, 50, 100];

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const cleanCount = Math.min(200, Math.max(1, Number(count) || 1));
      const res = await api.cards.autoGenerate({
        count: cleanCount,
        prefix: prefix.trim() || "GYM",
      });

      toast(
        "success",
        t("cards.autoGenerateSuccess", {
          count: res.count,
          from: res.fromBarcode,
          to: res.toBarcode,
        }),
      );
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const cleanPrefix = (prefix.trim() || "GYM").toUpperCase();
  const formattedPrefix = cleanPrefix.endsWith("-") ? cleanPrefix : `${cleanPrefix}-`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("cards.autoGenerateTitle")}
      widthClass="max-w-md"
      footer={
        <>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            loading={submitting}
            disabled={submitting || count < 1}
          >
            <Sparkles className="size-4" />
            {t("cards.autoGenerateSubmit")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Input
            label={t("cards.autoGeneratePrefix")}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            disabled={submitting}
            placeholder="GYM"
          />
          <p className="text-[11px] text-faint">
            مثال: GYM أو الفرع مثل B1-CRD
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[13px] font-semibold text-subtle">
            {t("cards.autoGenerateCount")}
          </label>
          <div className="flex items-center gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCount(p)}
                className={`flex-1 rounded-xl border py-2 text-center text-xs font-bold transition-all ${
                  count === p
                    ? "border-neon bg-neon/15 text-neon"
                    : "border-line bg-surface/60 text-subtle hover:border-line hover:text-ink"
                }`}
              >
                {p} كارت
              </button>
            ))}
          </div>
          <Input
            type="number"
            min={1}
            max={200}
            value={String(count)}
            onChange={(e) => setCount(Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            disabled={submitting}
          />
          <p className="text-[11px] text-faint">
            الحد الأقصى للتوليد في الدفعة الواحدة 200 كارت
          </p>
        </div>

        <div className="rounded-xl border border-neon/20 bg-neon/5 p-3.5 text-xs text-subtle">
          <div className="flex items-center gap-2 font-bold text-neon mb-1">
            <Layers className="size-4" />
            <span>{t("cards.autoGeneratePreview")}</span>
          </div>
          <p className="leading-relaxed">
            سيقوم النظام بفحص أعلى كود موجود مسبقاً بنفس البادئة وتوليد{" "}
            <span className="font-bold text-ink tabnum">{count}</span> كارت متسلسل بصيغة:
          </p>
          <div className="mt-2 rounded-lg bg-panel/80 p-2 font-mono text-center text-sm font-bold tracking-wider text-neon">
            {formattedPrefix}XXXXXX
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

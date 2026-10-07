import { useState, useRef } from "react";
import { Download, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, ArrowUpCircle } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseCsv, downloadCsvWithBom, normalizeDateInput } from "@/utils/csv-helper";
import { api, type ImportMemberRowInput, type BulkImportResult } from "@/api";
import { describeError } from "@/utils/app-error";

interface MemberImportModalProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export function MemberImportModal({ open, onClose, onImportComplete }: MemberImportModalProps) {
  const t = useT();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsedRows, setParsedRows] = useState<ImportMemberRowInput[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  const handleDownloadTemplate = () => {
    const headers = [
      "الاسم الكامل",
      "رقم الهاتف",
      "النوع (ذكر/أنثى)",
      "تاريخ الميلاد (يوم/شهر/سنة)",
      "القسم (عام/رجال/سيدات)",
      "العنوان",
      "ملاحظات",
      "اسم الباقة",
      "تاريخ بداية الاشتراك (يوم/شهر/سنة)",
      "تاريخ نهاية الاشتراك (يوم/شهر/سنة)",
      "المبلغ المدفوع (جنيه)",
    ];

    const sampleRows = [
      [
        "أحمد محمد علي",
        "01012345678",
        "ذكر",
        "15/05/1995",
        "عام",
        "القاهرة - المعادي",
        "عضو سابق من السيستم القديم",
        "شهري",
        "01/10/2026",
        "31/10/2026",
        "400",
      ],
      [
        "سارة محمود إبراهيم",
        "01198765432",
        "أنثى",
        "20/09/1998",
        "سيدات",
        "الجيزة",
        "",
        "3 شهور",
        "15/09/2026",
        "15/12/2026",
        "1000",
      ],
    ];

    downloadCsvWithBom(t("members.importTemplateName"), headers, sampleRows);
    toast("success", t("toast.saved"));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const rawRows = parseCsv(text);
      if (rawRows.length <= 1) {
        toast("error", t("errors.unexpectedShort"));
        return;
      }

      // Ignore header row (index 0)
      const dataRows = rawRows.slice(1);
      const converted: ImportMemberRowInput[] = [];

      for (const row of dataRows) {
        if (!row || row.length === 0 || !row[0]?.trim()) continue;

        const fullName = (row[0] ?? "").trim();
        const rawPhone = (row[1] ?? "").trim();
        const rawGender = (row[2] ?? "").trim().toLowerCase();
        const rawDob = (row[3] ?? "").trim();
        const rawDept = (row[4] ?? "").trim().toLowerCase();
        const address = (row[5] ?? "").trim() || null;
        const notes = (row[6] ?? "").trim() || null;
        const planName = (row[7] ?? "").trim() || null;
        const subStart = (row[8] ?? "").trim() || null;
        const subEnd = (row[9] ?? "").trim() || null;
        const rawPaid = (row[10] ?? "").trim();

        let gender: "male" | "female" | null = null;
        if (rawGender.includes("ذكر") || rawGender === "male" || rawGender === "m") {
          gender = "male";
        } else if (rawGender.includes("أنثى") || rawGender.includes("انثى") || rawGender === "female" || rawGender === "f") {
          gender = "female";
        }

        let department: "general" | "men" | "women" = "general";
        if (rawDept.includes("رجال") || rawDept === "men") {
          department = "men";
        } else if (rawDept.includes("سيدات") || rawDept === "women") {
          department = "women";
        }

        const paidAmount = rawPaid && !isNaN(Number(rawPaid)) ? Number(rawPaid) : null;

        converted.push({
          fullName,
          phone: rawPhone || null,
          gender,
          dateOfBirth: normalizeDateInput(rawDob),
          department,
          address,
          notes,
          planName,
          subscriptionStartDate: normalizeDateInput(subStart),
          subscriptionEndDate: normalizeDateInput(subEnd),
          paidAmount,
        });
      }

      setParsedRows(converted);
    };

    reader.readAsText(file, "UTF-8");
  };

  const handleStartImport = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);

    try {
      const result = await api.members.bulkImport(parsedRows);
      setImportResult(result);
      toast("success", t("toast.saved"));
      onImportComplete();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setParsedRows([]);
    setFileName(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("members.importModalTitle")}
      widthClass="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-subtle">
          {t("members.importModalSubtitle")}
        </p>

        {/* Step 1: Download Template */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-line bg-surface/80 p-3.5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileSpreadsheet className="size-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-ink">نموذج شيت إكسيل القياسي</h4>
              <p className="text-xs text-subtle">ملف متقسم بالأعمدة المطلوبة جاهز للتعبئة مباشرة</p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleDownloadTemplate}
            className="w-full sm:w-auto"
          >
            <Download className="size-3.5" />
            {t("members.importDownloadTemplate")}
          </Button>
        </div>

        {/* Step 2: Select file */}
        {!importResult && (
          <div className="rounded-2xl border border-dashed border-line-strong p-6 text-center hover:bg-white/[0.02] transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="mx-auto flex flex-col items-center gap-2">
              <div className="grid size-12 place-items-center rounded-2xl bg-white/5 text-subtle">
                <ArrowUpCircle className="size-6 text-primary" />
              </div>
              <h4 className="text-sm font-semibold text-ink">
                {fileName ? fileName : t("members.importDragPrompt")}
              </h4>
              <p className="text-xs text-faint">
                {parsedRows.length > 0
                  ? t("members.importRowsReady", { count: parsedRows.length })
                  : "يدعم ملفات CSV المحفوظة من Microsoft Excel"}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2"
              >
                {t("members.importSelectFile")}
              </Button>
            </div>
          </div>
        )}

        {/* Ready to Import Actions */}
        {parsedRows.length > 0 && !importResult && (
          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-3">
            <span className="text-xs font-semibold text-primary">
              {t("members.importRowsReady", { count: parsedRows.length })}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleReset} disabled={importing}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleStartImport}
                loading={importing}
                disabled={importing}
              >
                {t("members.importStartBtn")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Result Summary */}
        {importResult && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-line bg-surface/90 p-4">
              <h4 className="text-sm font-bold text-ink mb-3">{t("members.importDoneTitle")}</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  <div>
                    <div className="text-[10px] text-emerald-300/80">ناجح</div>
                    <div className="text-sm font-black text-emerald-400">{importResult.successCount}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5">
                  <AlertTriangle className="size-4 text-amber-400" />
                  <div>
                    <div className="text-[10px] text-amber-300/80">تم التخطي</div>
                    <div className="text-sm font-black text-amber-400">{importResult.skippedCount}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-2.5">
                  <XCircle className="size-4 text-red-400" />
                  <div>
                    <div className="text-[10px] text-red-300/80">أخطاء</div>
                    <div className="text-sm font-black text-red-400">{importResult.errorCount}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Results table tail */}
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-panel border-b border-line text-faint">
                  <tr>
                    <th className="p-2">#</th>
                    <th className="p-2">{t("members.importColName")}</th>
                    <th className="p-2">{t("members.importColPhone")}</th>
                    <th className="p-2">{t("members.importColStatus")}</th>
                    <th className="p-2">{t("members.importColNotes")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40 text-subtle">
                  {importResult.results.map((res) => (
                    <tr key={res.rowNumber} className="hover:bg-white/[0.02]">
                      <td className="p-2 tabnum">{res.rowNumber}</td>
                      <td className="p-2 font-medium text-ink">{res.fullName}</td>
                      <td className="p-2 tabnum" dir="ltr">{res.phone || "—"}</td>
                      <td className="p-2">
                        {res.status === "success" && (
                          <Badge variant="success">
                            {t("members.importStatusSuccess")}
                          </Badge>
                        )}
                        {res.status === "skipped" && (
                          <Badge variant="warning">
                            {t("members.importStatusSkipped")}
                          </Badge>
                        )}
                        {res.status === "error" && (
                          <Badge variant="danger">
                            {t("members.importStatusError")}
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 text-faint">
                        {res.memberCode ? `كود: ${res.memberCode}` : res.errorReason ? t(res.errorReason) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={onClose}>
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

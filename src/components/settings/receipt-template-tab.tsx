import { useEffect, useState, useRef, type ChangeEvent } from "react";
import {
  Receipt,
  Save,
  Upload,
  Trash2,
  Percent,
  Printer,
  Building2,
  Phone,
  MapPin,
  Maximize2,
  FileText,
  Sliders,
  Download,
  Loader2,
} from "lucide-react";
import QRCode from "qrcode";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { KotbLogo } from "@/components/ui/kotb-logo";
import { cn } from "@/utils/cn";

export function ReceiptTemplateTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("settings.edit");
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [docKind, setDocKind] = useState<"subscription" | "store">("subscription");
  const [viewMode, setViewMode] = useState<"pdf" | "interactive">("pdf");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [, setPdfFileName] = useState("preview-receipt.pdf");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [printingSample, setPrintingSample] = useState(false);

  // Form states
  const [gymName, setGymName] = useState("");
  const [gymPhone, setGymPhone] = useState("");
  const [gymAddress, setGymAddress] = useState("");
  const [receiptTitle, setReceiptTitle] = useState("");

  const [showLogo, setShowLogo] = useState(true);
  const [logoData, setLogoData] = useState("");
  const [logoWidth, setLogoWidth] = useState("100"); // default 100px

  const [showTax, setShowTax] = useState(false);
  const [taxPercent, setTaxPercent] = useState("14");

  const [showQr, setShowQr] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const [footerText, setFooterText] = useState("");
  const [terms, setTerms] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load settings on mount
  useEffect(() => {
    let active = true;
    api.settings
      .readAll()
      .then((records: Record<string, string>) => {
        if (!active) return;

        setGymName(records[SETTING_KEYS.gymName] ?? "");
        setGymPhone(records[SETTING_KEYS.gymPhone] ?? "");
        setGymAddress(records[SETTING_KEYS.gymAddress] ?? "");
        setReceiptTitle(records[SETTING_KEYS.receiptTitle] ?? "إيصال سداد واشتراك");

        setShowLogo((records[SETTING_KEYS.receiptShowLogo] ?? "1") === "1");
        setLogoData(records[SETTING_KEYS.receiptLogoData] ?? "");
        setLogoWidth(records[SETTING_KEYS.receiptLogoWidth] ?? "100");

        setShowTax((records[SETTING_KEYS.receiptShowTax] ?? "0") === "1");
        setTaxPercent(records[SETTING_KEYS.receiptTaxPercent] ?? "14");

        setShowQr((records[SETTING_KEYS.receiptShowQr] ?? "1") === "1");

        setFooterText(
          records[SETTING_KEYS.receiptFooterText] ??
            "شكراً لاختياركم صالتنا الرياضية.. نتمنى لكم تمريناً ممتعاً!"
        );
        setTerms(
          records[SETTING_KEYS.receiptTerms] ??
            "1. الاشتراك شخصي ولا يجوز التنازل عنه لغير المشترك.\n2. النادي غير مسؤول عن فقدان المقتنيات الشخصية داخل الخزائن.\n3. الالتزام بالزي الرياضي وحذاء التمرين النظيف.\n4. التجميد يتم وفقاً لضوابط الباقة المحددة مسبقاً."
        );
      })
      .catch((err) => {
        toast("error", describeError(err, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t, toast]);

  // Generate dynamic QR Code for live preview
  useEffect(() => {
    if (!showQr) {
      setQrDataUrl("");
      return;
    }
    const taxNum = parseInt(taxPercent, 10) || 0;
    const baseAmount = 700;
    const totalAmount = showTax ? baseAmount + Math.round((baseAmount * taxNum) / 100) : baseAmount;

    const qrPayload = JSON.stringify({
      gym: gymName || "GymGate",
      receipt: "B1-U1-RCP-2026-000124",
      member: "B1-MEM-000124",
      amount: `${totalAmount}.00 EGP`,
      date: new Date().toISOString().slice(0, 10),
    });

    QRCode.toDataURL(qrPayload, {
      width: 140,
      margin: 1,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(""));
  }, [showQr, gymName, showTax, taxPercent]);

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast("error", "حجم الصورة كبير جداً، الحد الأقصى المسموح به هو 2 ميجابايت");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLogoData(dataUrl);
      setShowLogo(true);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoData("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const parsedLogoWidth = Math.max(40, Math.min(220, parseInt(logoWidth, 10) || 100));

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const updates: Array<{ key: string; value: string }> = [
        { key: SETTING_KEYS.gymName, value: gymName.trim() },
        { key: SETTING_KEYS.gymPhone, value: gymPhone.trim() },
        { key: SETTING_KEYS.gymAddress, value: gymAddress.trim() },
        { key: SETTING_KEYS.receiptTitle, value: receiptTitle.trim() },
        { key: SETTING_KEYS.receiptShowLogo, value: showLogo ? "1" : "0" },
        { key: SETTING_KEYS.receiptLogoData, value: logoData },
        { key: SETTING_KEYS.receiptLogoWidth, value: String(parsedLogoWidth) },
        { key: SETTING_KEYS.receiptShowTax, value: showTax ? "1" : "0" },
        {
          key: SETTING_KEYS.receiptTaxPercent,
          value: String(Math.max(0, Math.min(100, parseInt(taxPercent, 10) || 0))),
        },
        { key: SETTING_KEYS.receiptShowQr, value: showQr ? "1" : "0" },
        { key: SETTING_KEYS.receiptFooterText, value: footerText.trim() },
        { key: SETTING_KEYS.receiptTerms, value: terms.trim() },
      ];

      for (const item of updates) {
        await api.settings.update(item.key, item.value);
      }

      toast("success", t("settings.receiptSaveSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const createPdfBlobUrl = (base64: string): string => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  };

  // Debounced effect to generate official PDF preview whenever form inputs change
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setPdfLoading(true);
      try {
        const taxNum = Math.max(0, Math.min(100, parseInt(taxPercent, 10) || 0));
        const res = await api.pdf.previewReceiptTemplate({
          gymName,
          gymPhone,
          gymAddress,
          receiptTitle,
          showLogo,
          logoData,
          logoWidth: parsedLogoWidth,
          showTax,
          taxPercent: taxNum,
          showQr,
          footerText,
          terms,
          docKind,
        });
        if (!active) return;
        const newUrl = createPdfBlobUrl(res.base64);
        setPdfBlobUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return newUrl;
        });
        setPdfFileName(res.fileName);
      } catch (err) {
        console.error("PDF Preview generation error:", err);
      } finally {
        if (active) setPdfLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    gymName,
    gymPhone,
    gymAddress,
    receiptTitle,
    showLogo,
    logoData,
    parsedLogoWidth,
    showTax,
    taxPercent,
    showQr,
    footerText,
    terms,
    docKind,
  ]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  // Official print handler using exact backend PDF bytes
  const handlePrint = async (targetDocKind = docKind) => {
    setPrintingSample(true);
    try {
      const taxNum = Math.max(0, Math.min(100, parseInt(taxPercent, 10) || 0));
      const res = await api.pdf.previewReceiptTemplate({
        gymName,
        gymPhone,
        gymAddress,
        receiptTitle,
        showLogo,
        logoData,
        logoWidth: parsedLogoWidth,
        showTax,
        taxPercent: taxNum,
        showQr,
        footerText,
        terms,
        docKind: targetDocKind,
      });

      const blobUrl = createPdfBlobUrl(res.base64);
      let printed = false;
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = blobUrl;
      document.body.appendChild(frame);

      const triggerPrint = () => {
        if (printed) return;
        printed = true;
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(blobUrl, "_blank");
        }
      };

      frame.onload = () => triggerPrint();
      window.setTimeout(() => {
        if (!printed) triggerPrint();
      }, 1000);

      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(blobUrl);
      }, 60000);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPrintingSample(false);
    }
  };

  const handleDownloadPdf = async (targetDocKind = docKind) => {
    try {
      const taxNum = Math.max(0, Math.min(100, parseInt(taxPercent, 10) || 0));
      const res = await api.pdf.previewReceiptTemplate({
        gymName,
        gymPhone,
        gymAddress,
        receiptTitle,
        showLogo,
        logoData,
        logoWidth: parsedLogoWidth,
        showTax,
        taxPercent: taxNum,
        showQr,
        footerText,
        terms,
        docKind: targetDocKind,
      });
      const blobUrl = createPdfBlobUrl(res.base64);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast("success", "تم تحميل ملف الفاتورة التجريبية بنجاح");
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-subtle">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const taxNum = Math.max(0, Math.min(100, parseInt(taxPercent, 10) || 0));

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-line bg-panel p-5 shadow-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">
                {t("settings.receiptTemplateTitle")}
              </h2>
              <p className="text-xs text-subtle mt-0.5">
                {t("settings.receiptTemplateDesc")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => handlePrint()}
            className="flex items-center gap-2 text-xs font-semibold"
          >
            <Printer className="h-4 w-4 text-emerald" />
            <span>{t("settings.receiptPrintSample")}</span>
          </Button>

          {canEdit && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={saving}
              disabled={saving}
              onClick={handleSave}
              className="flex items-center gap-2 text-xs font-semibold shadow-glow-sm"
            >
              <Save className="h-4 w-4" />
              <span>{t("settings.receiptSaveBtn")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Form Settings (Left 7 cols) & Live Preview (Right 5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Right Side: Configuration Form (7 cols) */}
        <div className="xl:col-span-7 space-y-6">
          {/* Card 1: Logo & Header Customization */}
          <Card>
            <CardHeader
              title={t("settings.receiptHeaderSection")}
              description="التحكم في الشعار وحجمه والعنوان الذي يظهر في رأس كل إيصال مطبوع"
            />
            <div className="space-y-5 p-5">
              {/* Show Logo Toggle */}
              <div className="flex items-center justify-between rounded-xl border border-line bg-surface/60 p-3.5">
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-ink">
                    {t("settings.receiptShowLogo")}
                  </span>
                  <p className="text-xs text-subtle">
                    {t("settings.receiptShowLogoHint")}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={showLogo}
                  disabled={!canEdit}
                  onChange={(e) => setShowLogo(e.target.checked)}
                  className="h-5 w-5 rounded border-line accent-primary cursor-pointer"
                />
              </div>

              {/* Logo Uploader & Size Slider */}
              {showLogo && (
                <div className="space-y-4 rounded-xl border border-line bg-surface/30 p-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-subtle">
                      {t("settings.receiptLogoLabel")}
                    </label>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <div
                        className="flex shrink-0 items-center justify-center rounded-xl border border-line bg-panel overflow-hidden p-1 shadow-sm transition-all"
                        style={{ width: `${Math.min(parsedLogoWidth, 220)}px`, minWidth: "80px", height: "80px" }}
                      >
                        {logoData ? (
                          <img
                            src={logoData}
                            alt="Logo Preview"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-subtle gap-1 text-center">
                            <KotbLogo variant="light" size="sm" showSubtitle={false} />
                            <span className="text-[9px] text-faint">الافتراضي</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-2 text-center sm:text-right">
                        <p className="text-xs text-subtle">
                          {t("settings.receiptLogoHint")}
                        </p>
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={!canEdit}
                            onChange={handleLogoUpload}
                            className="hidden"
                            id="logo-upload-input"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!canEdit}
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 text-xs"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            <span>{t("settings.receiptLogoUpload")}</span>
                          </Button>

                          {logoData && canEdit && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleRemoveLogo}
                              className="flex items-center gap-1.5 text-xs text-red hover:bg-red/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>{t("settings.receiptLogoRemove")}</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Logo Width / Size Control */}
                  <div className="pt-3 border-t border-line/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-subtle">
                        <Sliders className="h-3.5 w-3.5 text-primary" />
                        <span>{t("settings.receiptLogoSizeLabel")}</span>
                      </label>
                      <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                        {parsedLogoWidth}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="220"
                      step="5"
                      value={parsedLogoWidth}
                      disabled={!canEdit}
                      onChange={(e) => setLogoWidth(e.target.value)}
                      className="w-full accent-primary cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-faint">
                      <span>صغير (40px)</span>
                      <span>متوسط (100px)</span>
                      <span>عريض وكبير (220px)</span>
                    </div>
                    <p className="text-[11px] text-faint">
                      {t("settings.receiptLogoSizeHint")}
                    </p>
                  </div>
                </div>
              )}

              {/* Document Header Title */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-subtle">
                  {t("settings.receiptDocumentTitleLabel")}
                </label>
                <Input
                  value={receiptTitle}
                  disabled={!canEdit}
                  onChange={(e) => setReceiptTitle(e.target.value)}
                  placeholder="إيصال سداد واشتراك"
                />
              </div>
            </div>
          </Card>

          {/* Card 2: Gym Contact Info */}
          <Card>
            <CardHeader
              title={t("settings.receiptGeneralSection")}
              description="البيانات الرسمية للصالة الرياضية التي تظهر في رأس الفاتورة للعملاء"
            />
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-subtle">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t("settings.receiptGymNameLabel")}</span>
                </label>
                <Input
                  value={gymName}
                  disabled={!canEdit}
                  onChange={(e) => setGymName(e.target.value)}
                  placeholder="اسم النادي الرياضي"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-subtle">
                  <Phone className="h-3.5 w-3.5 text-primary" />
                  <span>{t("settings.receiptGymPhoneLabel")}</span>
                </label>
                <Input
                  value={gymPhone}
                  disabled={!canEdit}
                  onChange={(e) => setGymPhone(e.target.value)}
                  placeholder="01012345678"
                  dir="ltr"
                  className="text-right"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-subtle">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  <span>{t("settings.receiptGymAddressLabel")}</span>
                </label>
                <Input
                  value={gymAddress}
                  disabled={!canEdit}
                  onChange={(e) => setGymAddress(e.target.value)}
                  placeholder="القاهرة، جمهورية مصر العربية"
                />
              </div>
            </div>
          </Card>

          {/* Card 3: Tax & QR Verification */}
          <Card>
            <CardHeader
              title={t("settings.receiptTaxSection")}
              description="تفعيل ضريبة القيمة المضافة ورمز الاستجابة السريعة للتحقق"
            />
            <div className="space-y-5 p-5">
              {/* Show Tax Toggle */}
              <div className="flex items-center justify-between rounded-xl border border-line bg-surface/60 p-3.5">
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-ink">
                    {t("settings.receiptShowTax")}
                  </span>
                  <p className="text-xs text-subtle">
                    {t("settings.receiptShowTaxHint")}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={showTax}
                  disabled={!canEdit}
                  onChange={(e) => setShowTax(e.target.checked)}
                  className="h-5 w-5 rounded border-line accent-primary cursor-pointer"
                />
              </div>

              {/* Tax Percentage */}
              {showTax && (
                <div className="animate-fade-in space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-subtle">
                    <Percent className="h-3.5 w-3.5 text-primary" />
                    <span>{t("settings.receiptTaxPercent")}</span>
                  </label>
                  <div className="relative max-w-xs">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={taxPercent}
                      disabled={!canEdit}
                      onChange={(e) => setTaxPercent(e.target.value)}
                      className="pe-8"
                    />
                    <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs font-bold text-subtle">
                      %
                    </span>
                  </div>
                  <p className="text-[11px] text-faint">
                    {t("settings.receiptTaxPercentHint")}
                  </p>
                </div>
              )}

              {/* Show QR Code Toggle */}
              <div className="flex items-center justify-between rounded-xl border border-line bg-surface/60 p-3.5">
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-ink">
                    {t("settings.receiptShowQr")}
                  </span>
                  <p className="text-xs text-subtle">
                    {t("settings.receiptShowQrHint")}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={showQr}
                  disabled={!canEdit}
                  onChange={(e) => setShowQr(e.target.checked)}
                  className="h-5 w-5 rounded border-line accent-primary cursor-pointer"
                />
              </div>
            </div>
          </Card>

          {/* Card 4: Footer & Terms */}
          <Card>
            <CardHeader
              title={t("settings.receiptFooterSection")}
              description="الشروط واللائحة الداخلية التي تحفظ حقوق النادي وتظهر أسفل الفاتورة"
            />
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-subtle">
                  {t("settings.receiptFooterTextLabel")}
                </label>
                <Input
                  value={footerText}
                  disabled={!canEdit}
                  onChange={(e) => setFooterText(e.target.value)}
                  placeholder={t("settings.receiptFooterTextPlaceholder")}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-subtle">
                  {t("settings.receiptTermsLabel")}
                </label>
                <textarea
                  value={terms}
                  disabled={!canEdit}
                  rows={4}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder={t("settings.receiptTermsPlaceholder")}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                />
                <p className="mt-1 text-[11px] text-faint">
                  {t("settings.receiptTermsHint")}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Left Side: Live Sticky Receipt Preview (5 cols) */}
        <div className="xl:col-span-5 xl:sticky xl:top-6 space-y-3">
          {/* Preview Controls Bar */}
          <div className="rounded-2xl border border-line bg-panel p-4 shadow-card space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-2 rounded-full",
                    pdfLoading ? "bg-amber-500 animate-spin" : "bg-emerald animate-pulse"
                  )}
                />
                <span className="text-xs font-bold text-ink">
                  {pdfLoading ? "جارٍ تحديث المعاينة..." : "المعاينة الحية للورقة الرسمية"}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                  title="تكبير ملء الشاشة ومعاينة كاملة"
                  className="h-7 px-2 text-xs text-subtle hover:text-ink flex items-center gap-1"
                >
                  <Maximize2 className="size-3.5" />
                  <span className="hidden sm:inline">تكبير</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={printingSample}
                  disabled={printingSample}
                  onClick={() => handlePrint()}
                  title="طباعة عينة رسمية"
                  className="h-7 px-2.5 text-xs flex items-center gap-1 text-emerald"
                >
                  <Printer className="size-3.5" />
                  <span>طباعة</span>
                </Button>
              </div>
            </div>

            {/* DocKind Toggle: Subscription vs Store */}
            <div className="grid grid-cols-2 gap-2 bg-surface p-1 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setDocKind("subscription")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all",
                  docKind === "subscription"
                    ? "bg-primary text-white shadow-sm"
                    : "text-subtle hover:text-ink"
                )}
              >
                <Receipt className="size-3.5" />
                <span>فاتورة اشتراك (عضوية)</span>
              </button>
              <button
                type="button"
                onClick={() => setDocKind("store")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all",
                  docKind === "store"
                    ? "bg-primary text-white shadow-sm"
                    : "text-subtle hover:text-ink"
                )}
              >
                <FileText className="size-3.5" />
                <span>فاتورة متجر (مبيعات)</span>
              </button>
            </div>

            {/* View Mode Toggle: Real PDF vs Interactive Replica */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-subtle text-[11px]">طريقة العرض:</span>
              <div className="flex items-center gap-1.5 bg-surface p-0.5 rounded-lg border border-line/60">
                <button
                  type="button"
                  onClick={() => setViewMode("pdf")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                    viewMode === "pdf"
                      ? "bg-panel text-primary shadow-xs font-bold border border-line"
                      : "text-subtle hover:text-ink"
                  )}
                >
                  مستند PDF الفعلي
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("interactive")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                    viewMode === "interactive"
                      ? "bg-panel text-primary shadow-xs font-bold border border-line"
                      : "text-subtle hover:text-ink"
                  )}
                >
                  ورقة تفاعلية سريعة
                </button>
              </div>
            </div>
          </div>

          {/* Paper Container */}
          <div className="flex justify-center bg-[#070b14]/70 p-3 sm:p-4 rounded-2xl border border-line/80 overflow-hidden shadow-inner min-h-[520px]">
            {viewMode === "pdf" ? (
              pdfBlobUrl ? (
                <div className="relative w-full h-[620px] rounded-xl overflow-hidden border border-slate-300 bg-white">
                  {pdfLoading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-xs flex items-center justify-center z-10">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  )}
                  <iframe
                    src={pdfBlobUrl}
                    className="w-full h-full border-0"
                    title="معاينة PDF المباشرة"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-subtle p-12 gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs">جارٍ توليد المعاينة الرسمية...</span>
                </div>
              )
            ) : (
              <div id="receipt-preview-content" className="w-full flex justify-center">
                <ReceiptPaperContent
                  gymName={gymName || "صالة اللياقة الرياضية"}
                  gymPhone={gymPhone || "01012345678"}
                  gymAddress={gymAddress || "الفرع الرئيسي - شارع النصر"}
                  receiptTitle={receiptTitle || "إيصال سداد واشتراك"}
                  showLogo={showLogo}
                  logoData={logoData}
                  logoWidth={parsedLogoWidth}
                  showTax={showTax}
                  taxPercent={taxNum}
                  showQr={showQr}
                  qrDataUrl={qrDataUrl}
                  footerText={footerText}
                  terms={terms}
                  format={docKind === "store" ? "store" : "a4"}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Fullscreen Preview Modal */}
      {previewOpen && (
        <ReceiptPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          docKind={docKind}
          onDocKindChange={setDocKind}
          pdfBlobUrl={pdfBlobUrl}
          pdfLoading={pdfLoading}
          onPrint={() => handlePrint(docKind)}
          onDownload={() => handleDownloadPdf(docKind)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt Paper Content Component (Shared between Live Preview & Modal)
// ─────────────────────────────────────────────────────────────────────────────

interface PaperProps {
  gymName: string;
  gymPhone: string;
  gymAddress: string;
  receiptTitle: string;
  showLogo: boolean;
  logoData: string;
  logoWidth: number;
  showTax: boolean;
  taxPercent: number;
  showQr: boolean;
  qrDataUrl: string;
  footerText: string;
  terms: string;
  format: "thermal" | "a4" | "store";
}

function ReceiptPaperContent({
  gymName,
  gymPhone,
  gymAddress,
  receiptTitle,
  showLogo,
  logoData,
  logoWidth,
  showTax,
  taxPercent,
  showQr,
  qrDataUrl,
  footerText,
  terms,
  format,
}: PaperProps) {
  const sampleBasePrice = 750;
  const sampleDiscount = 50;
  const sampleSubtotal = sampleBasePrice - sampleDiscount;
  const taxAmount = showTax ? Math.round((sampleSubtotal * taxPercent) / 100) : 0;
  const sampleTotal = sampleSubtotal + taxAmount;
  const today = new Date().toISOString().slice(0, 10);

  if (format === "a4") {
    const subParts = [receiptTitle || "فاتورة دفع رسمية"];
    if (gymAddress) subParts.push(gymAddress);
    if (gymPhone) subParts.push(`هاتف: ${gymPhone}`);
    const subTextStr = subParts.join(" • ");

    const termsList = terms
      ? terms
          .split("\n")
          .filter(Boolean)
          .slice(0, 4)
      : [];

    return (
      <div
        className="w-full max-w-[580px] bg-white text-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-300 select-none animate-fade-in font-sans"
        dir="rtl"
      >
        {/* Top Header Banner (Dark Teal #0f766e) */}
        <div className="bg-[#0f766e] relative p-5 text-white flex justify-between items-center overflow-hidden">
          {/* Subtle Diagonal Strip on Left */}
          <div
            className="absolute left-0 top-0 bottom-0 w-36 bg-[#115e59] z-0"
            style={{ clipPath: "polygon(0 0, 100% 0, 65% 100%, 0 100%)" }}
          />

          {/* Left Side: Logo & Reference No & Date */}
          <div className="relative z-10 flex items-center gap-3 text-left">
            {showLogo && (
              logoData ? (
                <img
                  src={logoData}
                  alt="Logo"
                  style={{ width: `${Math.min(logoWidth, 220)}px` }}
                  className="max-h-14 object-contain drop-shadow"
                />
              ) : (
                <KotbLogo variant="light" size="sm" showSubtitle={false} />
              )
            )}
            <div>
              <div className="text-xs sm:text-sm font-black text-white tracking-tight">
                رقم المرجع: B1-U1-RCP-2026-000124
              </div>
              <div className="text-[10px] sm:text-[11px] text-[#ccfbf1] mt-0.5">
                {today} • فرع: الفرع الرئيسي (B1)
              </div>
            </div>
          </div>

          {/* Right Side: Gym Name & Subtitle */}
          <div className="relative z-10 text-right">
            <h1 className="text-lg sm:text-2xl font-black text-white leading-tight">
              {gymName}
            </h1>
            <p className="text-[10px] sm:text-[11px] text-[#ccfbf1] mt-0.5 font-medium">
              {subTextStr}
            </p>
          </div>
        </div>

        {/* Receipt Content Body */}
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          {/* Member Details Card */}
          <div className="bg-[#f8fafc] border border-slate-300 rounded-lg p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <span className="text-[10px] text-slate-500 block">اسم العضو</span>
                <strong className="text-slate-900 text-xs sm:text-sm font-bold block mt-0.5">
                  كابتن / محمد أحمد محمود
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">كود العضوية</span>
                <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm block mt-0.5">
                  B1-MEM-000124
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">رقم الموبايل</span>
                <span className="font-mono text-slate-900 text-xs block mt-0.5" dir="ltr">
                  01098765432
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">الباقة</span>
                <span className="font-semibold text-slate-900 text-xs block mt-0.5">
                  اشتراك لياقة وبناء أجسام شامل
                </span>
              </div>
            </div>
          </div>

          {/* Section: Financial breakdown */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1 h-3.5 bg-[#0f766e] rounded-full inline-block" />
              <span className="font-bold text-slate-900 text-xs">بيانات الدفع والمبالغ المالية</span>
            </div>

            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600 font-bold">
                  <th className="py-2 px-3 rounded-r-md">البند والبيان</th>
                  <th className="py-2 px-3 text-left rounded-l-md">المبلغ - ج.م</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="py-2 px-3">قيمة الاشتراك الأساسية</td>
                  <td className="py-2 px-3 text-left font-mono font-bold text-slate-900">
                    {sampleBasePrice}.00
                  </td>
                </tr>
                {sampleDiscount > 0 && (
                  <tr className="text-red-700">
                    <td className="py-1.5 px-3">الخصم المطبق</td>
                    <td className="py-1.5 px-3 text-left font-mono font-bold">
                      - {sampleDiscount}.00
                    </td>
                  </tr>
                )}
                {showTax && (
                  <tr>
                    <td className="py-1.5 px-3">ضريبة القيمة المضافة ({taxPercent}%)</td>
                    <td className="py-1.5 px-3 text-left font-mono font-bold text-slate-900">
                      {taxAmount}.00
                    </td>
                  </tr>
                )}
                <tr className="font-bold border-t border-slate-300">
                  <td className="py-2 px-3 text-slate-900">الإجمالي المستحق</td>
                  <td className="py-2 px-3 text-left font-mono text-[#0f766e]">
                    {sampleTotal}.00
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Grand Emerald Total Box (Prominent) */}
          <div className="bg-[#f0fdf4] border-1.5 border-[#86efac] rounded-lg p-3.5 sm:p-4 flex items-center justify-between shadow-xs">
            <span className="text-sm sm:text-base font-extrabold text-[#047857]">
              الـمـبـلـغ الـمـدفـوع فـعـلـيـاً
            </span>
            <span className="text-lg sm:text-xl font-black font-mono text-[#047857]">
              ج.م {sampleTotal}.00
            </span>
          </div>

          {/* Section: Metadata */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1 h-3.5 bg-[#0f766e] rounded-full inline-block" />
              <span className="font-bold text-slate-900 text-xs">تفاصيل العملية والموظف</span>
            </div>

            <div className="bg-[#f8fafc] border border-slate-300 rounded-lg p-3 sm:p-4">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <span className="text-[10px] text-slate-500 block">طريقة الدفع</span>
                  <span className="font-bold text-slate-900 text-xs block mt-0.5">
                    نقداً (الخزينة الرئيسية)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">الموظف المسؤول</span>
                  <span className="font-bold text-slate-900 text-xs block mt-0.5">
                    أحمد محمود (كاشير)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">حالة الإيصال</span>
                  <span className="inline-block mt-0.5 px-2 py-0.5 bg-[#ecfdf5] border border-[#a7f3d0] text-[#047857] text-[10px] font-bold rounded">
                    مدفوع بالكامل
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">الفرع</span>
                  <span className="text-slate-900 text-xs block mt-0.5">
                    الفرع الرئيسي (B1)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Terms block */}
          {termsList.length > 0 && (
            <div className="bg-[#f8fafc] border border-slate-300 rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-bold text-slate-900">شروط وقواعد الاشتراك بالصالة:</div>
              {termsList.map((term, idx) => (
                <div key={idx} className="text-[10px] text-slate-600">
                  • {term}
                </div>
              ))}
            </div>
          )}

          {/* Footer with QR Code & Developer Credit */}
          <div className="border-t border-slate-300 pt-3.5 flex items-center justify-between gap-4">
            {showQr && (
              qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR"
                  className="size-16 border border-slate-200 rounded p-0.5 bg-white shrink-0"
                />
              ) : (
                <div className="size-16 bg-slate-900 flex items-center justify-center text-white text-[8px] font-mono rounded shrink-0">
                  QR CODE
                </div>
              )
            )}
            {!showQr && <div className="size-16 shrink-0" />}

            <div className="flex-1 text-center space-y-1">
              {footerText && (
                <p className="text-xs font-bold text-slate-700">
                  {footerText}
                </p>
              )}
              <div className="text-[9.5px] text-slate-500 font-mono">
                GymGate — <strong className="text-slate-900 font-sans">Powered by KOTB Digital Solutions</strong>
              </div>
            </div>

            <div className="size-16 shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  if (format === "store") {
    const subParts = [receiptTitle || "فاتورة مبيعات متجر"];
    if (gymAddress) subParts.push(gymAddress);
    if (gymPhone) subParts.push(`هاتف: ${gymPhone}`);
    const subTextStr = subParts.join(" • ");

    return (
      <div
        className="w-full max-w-[580px] bg-white text-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-300 select-none animate-fade-in font-sans"
        dir="rtl"
      >
        {/* Top Header Banner (Dark Teal #0f766e) */}
        <div className="bg-[#0f766e] relative p-5 text-white flex justify-between items-center overflow-hidden">
          {/* Subtle Diagonal Strip on Left */}
          <div
            className="absolute left-0 top-0 bottom-0 w-36 bg-[#115e59] z-0"
            style={{ clipPath: "polygon(0 0, 100% 0, 65% 100%, 0 100%)" }}
          />

          {/* Left Side: Logo & Reference No & Date */}
          <div className="relative z-10 flex items-center gap-3 text-left">
            {showLogo && (
              logoData ? (
                <img
                  src={logoData}
                  alt="Logo"
                  style={{ width: `${Math.min(logoWidth, 220)}px` }}
                  className="max-h-14 object-contain drop-shadow"
                />
              ) : (
                <KotbLogo variant="light" size="sm" showSubtitle={false} />
              )
            )}
            <div>
              <div className="text-xs sm:text-sm font-black text-white tracking-tight">
                رقم: B1-U1-POS-2026-000001
              </div>
              <div className="text-[10px] sm:text-[11px] text-[#ccfbf1] mt-0.5">
                {today} • فرع: الفرع الرئيسي (B1)
              </div>
            </div>
          </div>

          {/* Right Side: Gym Name & Subtitle */}
          <div className="relative z-10 text-right">
            <h1 className="text-lg sm:text-2xl font-black text-white leading-tight">
              {gymName}
            </h1>
            <p className="text-[10px] sm:text-[11px] text-[#ccfbf1] mt-0.5 font-medium">
              {subTextStr}
            </p>
          </div>
        </div>

        {/* Receipt Content Body */}
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          {/* Customer & Cashier Details Card */}
          <div className="bg-[#f8fafc] border border-slate-300 rounded-lg p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <span className="text-[10px] text-slate-500 block">العميل</span>
                <strong className="text-slate-900 text-xs sm:text-sm font-bold block mt-0.5">
                  عميل نقدي
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">الكاشير</span>
                <strong className="text-slate-900 text-xs sm:text-sm font-bold block mt-0.5">
                  ياسين محمد قطب
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">رقم الموبايل</span>
                <span className="text-slate-600 text-xs block mt-0.5">-</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">حالة السداد</span>
                <span className="inline-block mt-0.5 px-2 py-0.5 bg-[#ecfdf5] border border-[#a7f3d0] text-[#047857] text-[10px] font-bold rounded">
                  مسدد بالكامل
                </span>
              </div>
            </div>
          </div>

          {/* Section: Items Table */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1 h-3.5 bg-[#0f766e] rounded-full inline-block" />
              <span className="font-bold text-slate-900 text-xs">بيانات الأصناف والمنتجات</span>
            </div>

            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600 font-bold">
                  <th className="py-2 px-3 rounded-r-md">الصنف / المنتج</th>
                  <th className="py-2 px-3 text-center">الكمية</th>
                  <th className="py-2 px-3 text-center">سعر الوحدة - ج.م</th>
                  <th className="py-2 px-3 text-left rounded-l-md">الإجمالي - ج.م</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="py-2 px-3 font-medium">مشروب بروتين جولد ستاندرد 500 مل</td>
                  <td className="py-2 px-3 text-center font-mono">1</td>
                  <td className="py-2 px-3 text-center font-mono">65.00</td>
                  <td className="py-2 px-3 text-left font-mono font-bold text-slate-900">65.00</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-medium">لوح شوكولاتة كيتو بروتين 60 جم</td>
                  <td className="py-2 px-3 text-center font-mono">2</td>
                  <td className="py-2 px-3 text-center font-mono">40.00</td>
                  <td className="py-2 px-3 text-left font-mono font-bold text-slate-900">80.00</td>
                </tr>
                <tr className="text-slate-500 font-semibold border-t border-slate-200">
                  <td colSpan={3} className="py-2 px-3 text-left">إجمالي الأصناف:</td>
                  <td className="py-2 px-3 text-left font-mono font-bold text-slate-900">145.00</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Grand Emerald Total Box */}
          <div className="bg-[#f0fdf4] border-1.5 border-[#86efac] rounded-lg p-3.5 sm:p-4 flex items-center justify-between shadow-xs">
            <span className="text-sm sm:text-base font-extrabold text-[#047857]">
              صافي إجمالي الفاتورة
            </span>
            <span className="text-lg sm:text-xl font-black font-mono text-[#047857]">
              ج.م 145.00
            </span>
          </div>

          <div className="text-center">
            <span className="inline-block px-3 py-1 bg-[#ecfdf5] border border-[#a7f3d0] text-[#047857] text-xs font-black rounded-lg">
              مسدد بالكامل
            </span>
          </div>

          {/* Footer with QR Code & Developer Credit */}
          <div className="border-t border-slate-300 pt-3.5 flex items-center justify-between gap-4">
            {showQr && (
              qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR"
                  className="size-16 border border-slate-200 rounded p-0.5 bg-white shrink-0"
                />
              ) : (
                <div className="size-16 bg-slate-900 flex items-center justify-center text-white text-[8px] font-mono rounded shrink-0">
                  QR CODE
                </div>
              )
            )}
            {!showQr && <div className="size-16 shrink-0" />}

            <div className="flex-1 text-center space-y-1">
              {footerText && (
                <p className="text-xs font-bold text-slate-700">
                  {footerText}
                </p>
              )}
              <div className="text-[9.5px] text-slate-500 font-mono">
                GymGate — <strong className="text-slate-900 font-sans">Powered by KOTB Digital Solutions</strong>
              </div>
            </div>

            <div className="size-16 shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  // Thermal 80mm Realistic POS Receipt Layout
  return (
    <div
      className="w-[290px] sm:w-[310px] bg-[#fff] text-[#111] p-4 text-[11px] font-sans leading-tight shadow-2xl border-t-4 border-slate-800 select-none animate-fade-in"
      style={{
        boxShadow: "0 10px 30px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.2)",
      }}
      dir="rtl"
    >
      {/* Thermal Header */}
      <div className="text-center pb-2.5 mb-2.5 border-b border-dashed border-slate-400">
        {showLogo && (
          logoData ? (
            <div className="flex justify-center mb-2">
              <img
                src={logoData}
                alt="Logo"
                style={{ width: `${Math.min(logoWidth, 180)}px` }}
                className="max-h-24 object-contain"
              />
            </div>
          ) : (
            <div className="flex justify-center mb-1.5">
              <KotbLogo variant="navy" size="md" showSubtitle={true} />
            </div>
          )
        )}

        <h1 className="text-base font-black text-black tracking-tight">
          {gymName}
        </h1>

        {gymAddress && (
          <p className="text-[10px] text-slate-600 mt-0.5 leading-tight">
            {gymAddress}
          </p>
        )}
        {gymPhone && (
          <p className="text-[10px] text-slate-600 font-mono" dir="ltr">
            Tel: {gymPhone}
          </p>
        )}

        <div className="inline-block mt-2 rounded bg-slate-100 px-3 py-0.5 font-bold text-black text-[10.5px] border border-slate-300">
          {receiptTitle}
        </div>
      </div>

      {/* Receipt Meta */}
      <div className="pb-2 mb-2 text-[10.5px] space-y-0.5 border-b border-dashed border-slate-400">
        <div className="flex justify-between">
          <span className="text-slate-500">رقم الفاتورة:</span>
          <span className="font-bold font-mono">B1-U1-RCP-2026-000124</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">التاريخ والوقت:</span>
          <span className="font-mono">{today} - 04:30 م</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">الموظف:</span>
          <span>أحمد محمود [U1]</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">الفرع:</span>
          <span>الفرع الرئيسي (B1)</span>
        </div>
      </div>

      {/* Member Details */}
      <div className="pb-2 mb-2 text-[10.5px] space-y-0.5 border-b border-dashed border-slate-400 bg-slate-50 p-2 rounded">
        <div className="flex justify-between">
          <span className="text-slate-500">العضو:</span>
          <span className="font-bold text-black">كابتن / محمد أحمد</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">كود العضوية:</span>
          <span className="font-mono font-bold">B1-MEM-000124</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">الموبايل:</span>
          <span dir="ltr" className="font-mono">01098765432</span>
        </div>
      </div>

      {/* Plan Details Table */}
      <div className="pb-2 mb-2 border-b border-dashed border-slate-400">
        <table className="w-full text-right text-[10.5px]">
          <thead>
            <tr className="border-b border-slate-300 text-slate-500 font-semibold">
              <th className="pb-1 text-right">البيان</th>
              <th className="pb-1 text-center">المدة</th>
              <th className="pb-1 text-left">المبلغ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="py-1 font-bold">اشتراك لياقة شامل</td>
              <td className="py-1 text-center text-slate-600">30 يوم</td>
              <td className="py-1 text-left font-bold font-mono">{sampleBasePrice} ج.م</td>
            </tr>
            {sampleDiscount > 0 && (
              <tr className="text-emerald-700">
                <td className="py-0.5">خصم عرض الصيف</td>
                <td className="py-0.5 text-center">-</td>
                <td className="py-0.5 text-left font-bold font-mono">-{sampleDiscount} ج.م</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Financial Summary */}
      <div className="pb-2 mb-2 space-y-1 text-[10.5px] border-b border-dashed border-slate-400">
        <div className="flex justify-between">
          <span className="text-slate-600">المبلغ الصافي:</span>
          <span className="font-bold font-mono">{sampleSubtotal} ج.م</span>
        </div>

        {showTax && (
          <div className="flex justify-between text-slate-700">
            <span>ضريبة القيمة المضافة ({taxPercent}%):</span>
            <span className="font-bold font-mono">+{taxAmount} ج.م</span>
          </div>
        )}

        <div className="flex justify-between items-center text-xs font-bold text-black border-t border-slate-300 pt-1 mt-1">
          <span>الإجمالي المدفوع:</span>
          <span className="font-mono text-emerald-800 font-black text-sm">{sampleTotal} ج.م</span>
        </div>

        <div className="flex justify-between text-slate-500 text-[9.5px]">
          <span>طريقة الدفع:</span>
          <span>نقداً (خزينة الجيم)</span>
        </div>
      </div>

      {/* QR Code section */}
      {showQr && (
        <div className="py-2 text-center border-b border-dashed border-slate-400 flex flex-col items-center justify-center gap-1">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR Code"
              className="size-20 border border-slate-300 rounded p-1 bg-white shadow-sm"
            />
          ) : (
            <div className="size-16 bg-slate-900 flex items-center justify-center text-white text-[8px] font-mono p-1 text-center rounded">
              QR VERIFIED
            </div>
          )}
          <span className="text-[9px] text-slate-500">
            امسح الرمز للتحقق من صحة الفاتورة
          </span>
        </div>
      )}

      {/* Terms and Conditions */}
      {terms && (
        <div className="py-2 text-[9.5px] text-slate-600 border-b border-dashed border-slate-400 space-y-1">
          <p className="font-bold text-slate-800">شروط وقواعد الاشتراك:</p>
          <div className="whitespace-pre-line leading-relaxed pe-1">
            {terms}
          </div>
        </div>
      )}

      {/* Footer Text */}
      {footerText && (
        <div className="pt-2 text-center text-[10px] font-bold text-slate-700">
          {footerText}
        </div>
      )}

      <div className="mt-2 pt-1.5 border-t border-dotted border-slate-400 text-center text-[8.5px] text-slate-400">
        نظام إدارة الأندية الرياضية GymGate • تم الإصدار إلكترونياً
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen Modal Component
// ─────────────────────────────────────────────────────────────────────────────

interface ModalPropsExtended {
  open: boolean;
  onClose: () => void;
  docKind: "subscription" | "store";
  onDocKindChange: (kind: "subscription" | "store") => void;
  pdfBlobUrl: string | null;
  pdfLoading: boolean;
  onPrint: () => void;
  onDownload: () => void;
}

function ReceiptPreviewModal({
  open,
  onClose,
  docKind,
  onDocKindChange,
  pdfBlobUrl,
  pdfLoading,
  onPrint,
  onDownload,
}: ModalPropsExtended) {
  const t = useT();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("settings.receiptPreviewModalTitle")}
      widthClass="max-w-4xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 rounded-xl border border-line p-1 bg-surface">
            <button
              type="button"
              onClick={() => onDocKindChange("subscription")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                docKind === "subscription"
                  ? "bg-primary text-white shadow-sm"
                  : "text-subtle hover:text-ink"
              )}
            >
              فاتورة اشتراك (عضوية)
            </button>
            <button
              type="button"
              onClick={() => onDocKindChange("store")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                docKind === "store"
                  ? "bg-primary text-white shadow-sm"
                  : "text-subtle hover:text-ink"
              )}
            >
              فاتورة متجر (مبيعات)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onDownload}
              className="flex items-center gap-1.5 text-ink"
            >
              <Download className="h-4 w-4" />
              <span>تحميل PDF</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onPrint}
              className="flex items-center gap-1.5 text-emerald"
            >
              <Printer className="h-4 w-4" />
              <span>{t("settings.receiptPrintSample")}</span>
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-subtle">
          معاينة مطابقة تماماً لمستند PDF الرسمي الذي يتم طباعته وتحميله وإرساله للعملاء عبر الواتساب.
        </p>

        <div className="relative w-full h-[72vh] rounded-2xl border border-line bg-white shadow-inner overflow-hidden">
          {pdfLoading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-xs font-semibold text-ink">جارٍ توليد المعاينة...</span>
            </div>
          )}
          {pdfBlobUrl ? (
            <iframe
              src={pdfBlobUrl}
              className="w-full h-full border-0"
              title="معاينة الفاتورة الرسمية"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-subtle">
              <span className="text-xs">لا تتوفر معاينة</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

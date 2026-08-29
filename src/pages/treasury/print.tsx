import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useT } from "@/i18n";
import { api } from "@/api";
import type { DailyClosingDetail } from "@/core/services/daily-closing.service";
import { formatMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Printer } from "lucide-react";

export function TreasuryPrintPage() {
  const t = useT();
  const { closingId } = useParams<{ closingId: string }>();

  useEffect(() => {
    if (!closingId) return;
    let alive = true;
    api.treasury
      .getById(closingId)
      .then((d: DailyClosingDetail) => {
        if (alive) {
          const printStyles = `
            @media print {
              body { -webkit-print-color-adjust: exact; }
            }
          `;
          const boxLabel = d.box === "gym" ? t("treasury.boxGym") : t("treasury.boxStore");
          const formatStatus = (status: "open" | "closed" | "reopened") => {
            switch (status) {
              case "open": return t("treasury.statusOpen");
              case "closed": return t("treasury.statusClosed");
              case "reopened": return t("treasury.statusReopened");
            }
          };
          const methodMap: Record<string, string> = {
            cash: t("treasury.expectedCash"),
            bank_card: t("treasury.expectedCard"),
            transfer: t("treasury.expectedTransfer"),
            other: t("treasury.expectedOther"),
          };
          const originalContent = document.body.innerHTML;
          const printContent = `
            <div class="min-h-screen bg-white p-8">
              <div class="mb-8 text-center">
                <h1 class="text-3xl font-bold mb-4">${t("treasury.title")}</h1>
                <h2 class="text-2xl font-semibold mb-2">${t("treasury.detailTitle")}</h2>
              </div>
              <div class="grid gap-4 sm:grid-cols-2 text-center mb-6">
                <div>
                  <p class="text-sm text-muted">${t("treasury.dateLabel")}</p>
                  <p class="text-lg font-mono">${formatDateShort(new Date(d.businessDate.replace(" ", "T")))}</p>
                </div>
                <div>
                  <p class="text-sm text-muted">${t("treasury.boxLabel")}</p>
                  <p class="text-lg font-mono">${boxLabel}</p>
                </div>
              </div>
              <div class="border-t border-b py-4 mb-6">
                <div class="grid gap-4 sm:grid-cols-4 text-sm">
                  <div>
                    <p class="text-muted">${t("treasury.expectedCash")}</p>
                    <p class="font-mono">${formatMinor(d.expected.cash)}</p>
                  </div>
                  <div>
                    <p class="text-muted">${t("treasury.expectedCard")}</p>
                    <p class="font-mono">${formatMinor(d.expected.card)}</p>
                  </div>
                  <div>
                    <p class="text-muted">${t("treasury.expectedTransfer")}</p>
                    <p class="font-mono">${formatMinor(d.expected.transfer)}</p>
                  </div>
                  <div>
                    <p class="text-muted">${t("treasury.expectedOther")}</p>
                    <p class="font-mono">${formatMinor(d.expected.other)}</p>
                  </div>
                </div>
                <div class="pt-4 border-t">
                  <div class="grid gap-4 sm:grid-cols-4 text-lg font-bold">
                    <div>
                      <p class="text-muted">${t("treasury.expectedTotal")}</p>
                      <p class="font-mono">${formatMinor(d.expected.total)}</p>
                    </div>
                    <div>
                      <p class="text-muted">${t("treasury.countedCash")}</p>
                      <p class="font-mono">${d.countedCashMinor == null ? "—" : formatMinor(d.countedCashMinor)}</p>
                    </div>
                    <div>
                      <p class="text-muted">${t("treasury.difference")}</p>
                      <p class="font-mono">${d.differenceMinor == null ? "—" : formatMinor(d.differenceMinor)}</p>
                    </div>
                    <div>
                      <p class="text-muted">${t("treasury.statusLabel")}</p>
                      <p class="font-mono">${formatStatus(d.status)}</p>
                    </div>
                  </div>
                </div>
              </div>
              ${d.reason ? `
                <div class="mb-6 p-4 bg-base/50 rounded-lg">
                  <p class="text-sm font-medium mb-2">${t("treasury.reasonLabel")}</p>
                  <p class="break-all text-sm">${d.reason}</p>
                </div>
              ` : ""}
              ${d.openedByName ? `
                <div class="mb-6">
                  <div class="border-t border-b py-4">
                    <div class="grid gap-4 sm:grid-cols-3 text-sm">
                      <div>
                        <p class="text-muted">${t("treasury.openedBy")}</p>
                        <p class="font-mono">${d.openedByName}</p>
                      </div>
                      <div>
                        <p class="text-muted">${t("treasury.openedAt")}</p>
                        <p class="font-mono">${d.openedAt.slice(0, 16)}</p>
                      </div>
                      ${d.closedByName ? `
                        <div>
                          <p class="text-muted">${t("treasury.closedBy")}</p>
                          <p class="font-mono">${d.closedByName}</p>
                        </div>
                        <div>
                          <p class="text-muted">${t("treasury.closedAt")}</p>
                          <p class="font-mono">${d.closedAt?.slice(0, 16) ?? "—"}</p>
                        </div>
                      ` : ""}
                      ${d.reopenedByName ? `
                        <div>
                          <p class="text-muted">${t("treasury.reopenedBy")}</p>
                          <p class="font-mono">${d.reopenedByName}</p>
                        </div>
                        <div>
                          <p class="text-muted">${t("treasury.reopenedAt")}</p>
                          <p class="font-mono">${d.reopenedAt?.slice(0, 16) ?? "—"}</p>
                        </div>
                      ` : ""}
                    </div>
                  </div>
                </div>
              ` : ""}
              ${d.methodBreakdown && d.methodBreakdown.length > 0 ? `
                <div class="mb-6">
                  <h3 class="text-lg font-semibold mb-4">${t("treasury.methodBreakdown")}</h3>
                  <div class="overflow-x-auto">
                    <table class="min-w-full border-separate border-spacing-0">
                      <thead>
                        <tr class="border-b">
                          <th class="text-left text-sm font-medium text-muted px-4 py-2">${t("treasury.method")}</th>
                          <th class="text-left text-sm font-medium text-muted px-4 py-2">${t("treasury.expected")}</th>
                          <th class="text-left text-sm font-medium text-muted px-4 py-2">${t("treasury.counted")}</th>
                          <th class="text-left text-sm font-medium text-muted px-4 py-2">${t("treasury.difference")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${d.methodBreakdown.map((row) => `
                        <tr class="border-b">
                          <td class="text-left text-sm px-4 py-2">${methodMap[row.methodCode] || row.methodCode}</td>
                          <td class="text-left text-sm font-mono px-4 py-2">${formatMinor(row.expectedMinor)}</td>
                          <td class="text-left text-sm font-mono px-4 py-2">${row.actualMinor == null ? "—" : formatMinor(row.actualMinor)}</td>
                          <td class="text-left text-sm font-mono px-4 py-2">${row.actualMinor == null || row.expectedMinor === row.actualMinor ? "—" : formatMinor(Math.abs(row.actualMinor! - row.expectedMinor))}</td>
                        </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                </div>
              ` : ""}
            </div>
          `;
          document.body.innerHTML = printContent + printStyles;
          window.print();
          setTimeout(() => {
            document.body.innerHTML = originalContent;
            window.close();
          }, 1000);
        }
      })
      .catch((err) => {
        console.error(err);
        window.close();
      });
    return () => {
      alive = false;
    };
  }, [closingId, t]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-2">
        <Printer className="size-8 text-faint" />
        <p>{t("common.loading")}</p>
      </div>
    </div>
  );
}
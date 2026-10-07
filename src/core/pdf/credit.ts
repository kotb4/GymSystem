import PDFDocumentType from "pdfkit";
import { drawText, measureText } from "./arabic";

type PdfDoc = InstanceType<typeof PDFDocumentType>;

/**
 * Developer credit line printed on every generated document.
 * `System by :` sits beside the name in a lighter tone; the name itself is the
 * small, heavy, near-black part so the credit stays discreet but readable.
 * The pair is centred on the PAGE (not the content column) so it lines up
 * optically regardless of the surrounding layout.
 */
const CREDIT_LABEL = "System by :";
const CREDIT_NAME = "Yassen Mohamed Kotb | 01288536381";

const LABEL_SIZE = 7.5;
const NAME_SIZE = 8.5;
const GAP = 4;
const COLOR_LABEL = "#64748b"; // Slate 500
const COLOR_NAME = "#000000";

export function drawDeveloperCredit(doc: PdfDoc, y: number): void {
  const labelW = measureText(CREDIT_LABEL, { size: LABEL_SIZE, weight: "regular" });
  const nameW = measureText(CREDIT_NAME, { size: NAME_SIZE, weight: "bold" });
  const totalW = labelW + GAP + nameW;
  const startX = (doc.page.width - totalW) / 2;

  drawText(doc, CREDIT_LABEL, startX, y, labelW, {
    size: LABEL_SIZE,
    align: "left",
    color: COLOR_LABEL,
    weight: "regular",
  });
  drawText(doc, CREDIT_NAME, startX + labelW + GAP, y, nameW, {
    size: NAME_SIZE,
    align: "left",
    color: COLOR_NAME,
    weight: "bold",
  });
}

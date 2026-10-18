import * as pdfService from "../../src/core/services/pdf.service";
import { a, defineService, type Fn } from "./helpers";

export const pdf = defineService({
  generatePaymentReceipt: a(pdfService.generatePaymentReceipt as Fn),
  sendPaymentReceipt: a(pdfService.sendPaymentReceipt as Fn),
  generateStoreSaleReceipt: a(pdfService.generateStoreSaleReceipt as Fn),
  sendStoreSaleReceipt: a(pdfService.sendStoreSaleReceipt as Fn),
  generateSubscriptionContract: a(pdfService.generateSubscriptionContract as Fn),
  sendSubscriptionContract: a(pdfService.sendSubscriptionContract as Fn),
  generatePayslipPdf: a(pdfService.generatePayslipPdf as Fn),
  listPdfDeliveries: a(pdfService.listPdfDeliveries as Fn),
  previewReceiptTemplate: a(pdfService.previewReceiptTemplate as Fn),
});

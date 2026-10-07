import * as promoService from "../../src/core/services/promo.service";
import { a, defineService, type Fn } from "./helpers";

export const promo = defineService({
  createPromoCode: a(promoService.createPromoCode as Fn),
  listPromoCodes: a(promoService.listPromoCodes as Fn),
  validatePromoCode: a(promoService.validatePromoCode as Fn),
  togglePromoCode: a(promoService.togglePromoCode as Fn),
});

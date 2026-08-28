import * as cardsService from "../../src/core/services/cards.service";
import { a, p, defineService, type Fn } from "./helpers";

export const cards = defineService({
  nextBarcodePreview: p(cardsService.nextBarcodePreview as Fn),
  registerCard: a(cardsService.registerCard as Fn),
  assignCardByBarcode: a(cardsService.assignCardByBarcode as Fn),
  unassignCard: a(cardsService.unassignCard as Fn),
  reportCardLost: a(cardsService.reportCardLost as Fn),
  setCardBlocked: a(cardsService.setCardBlocked as Fn),
  listCards: a(cardsService.listCards as Fn),
  listMemberCards: a(cardsService.listMemberCards as Fn),
  registerCardsBulk: a(cardsService.registerCardsBulk as Fn),
});

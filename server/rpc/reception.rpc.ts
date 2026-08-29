import * as receptionService from "../../src/core/services/reception.service";
import { a, defineService, type Fn } from "./helpers";

export const reception = defineService({
  search: a(receptionService.search as Fn),
  lookup: a(receptionService.lookup as Fn),
  checkIn: a(receptionService.checkIn as Fn),
});

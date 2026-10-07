import * as docNumbers from "../../src/core/services/document-numbers.service";
import { a, defineService, type Fn } from "./helpers";

export const documentNumbers = defineService({
  searchByDocNo: a(docNumbers.searchByDocNo as Fn),
});

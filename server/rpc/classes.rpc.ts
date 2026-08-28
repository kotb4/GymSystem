import * as classesService from "../../src/core/services/classes.service";
import { a, defineService, type Fn } from "./helpers";

export const classes = defineService({
  listClasses: a(classesService.listClasses as Fn),
  createClass: a(classesService.createClass as Fn),
  updateClass: a(classesService.updateClass as Fn),
  createClassSession: a(classesService.createClassSession as Fn),
  listSessions: a(classesService.listSessions as Fn),
  cancelClassSession: a(classesService.cancelClassSession as Fn),
  uncancelClassSession: a(classesService.uncancelClassSession as Fn),
  completeClassSession: a(classesService.completeClassSession as Fn),
  listBookings: a(classesService.listBookings as Fn),
  listMemberBookings: a(classesService.listMemberBookings as Fn),
  bookMember: a(classesService.bookMember as Fn),
  cancelBooking: a(classesService.cancelBooking as Fn),
  setBookingStatus: a(classesService.setBookingStatus as Fn),
});

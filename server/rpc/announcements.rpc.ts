import * as announcementsService from "../../src/core/services/announcements.service";
import { a, p, defineService, type Fn } from "./helpers";

export const announcements = defineService({
  create: a(announcementsService.createAnnouncement as Fn),
  update: a(announcementsService.updateAnnouncement as Fn),
  delete: a(announcementsService.deleteAnnouncement as Fn),
  getById: p(announcementsService.getAnnouncementById as Fn),
  listActive: p(announcementsService.listActiveAnnouncements as Fn),
  listAll: a(announcementsService.listAllAnnouncements as Fn),
});

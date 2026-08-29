import * as leadService from "../../src/core/services/lead.service";
import { a, defineService, type Fn } from "./helpers";

export const lead = defineService({
  createLead: a(leadService.createLead as Fn),
  updateLead: a(leadService.updateLead as Fn),
  listLeads: a(leadService.listLeads as Fn),
  getLead: a(leadService.getLead as Fn),
  deleteLead: a(leadService.deleteLead as Fn),
  listFollowups: a(leadService.listFollowups as Fn),
  addFollowup: a(leadService.addFollowup as Fn),
  updateFollowup: a(leadService.updateFollowup as Fn),
  completeFollowup: a(leadService.completeFollowup as Fn),
  todayFollowups: a(leadService.todayFollowups as Fn),
  listActivity: a(leadService.listActivity as Fn),
  addActivity: a(leadService.addActivity as Fn),
  convertLead: a(leadService.convertLead as Fn),
  leadStats: a(leadService.leadStats as Fn),
});

import * as membersService from "../../src/core/services/members.service";
import { requirePermission } from "../../src/core/permissions";
import type { Db } from "../../src/db/engine";
import type { ServiceActor } from "../../src/core/permissions";
import { errNotFound, errValidation } from "../../src/core/errors";
import { recordAudit } from "../../src/core/services/audit.service";
import { nowStamp } from "@/core/dates";
import * as filesService from "../files.service";
import { a, defineService, type Fn } from "./helpers";

export const members = defineService({
  getMember: a(membersService.getMember as Fn),
  createMember: a(membersService.createMember as Fn),
  updateMember: a(membersService.updateMember as Fn),
  setMemberStatus: a(membersService.setMemberStatus as Fn),
  listMembers: a(membersService.listMembers as Fn),
  searchMembersForPicker: a(membersService.searchMembersForPicker as Fn),
  trashMember: a(membersService.trashMember as Fn),
  restoreMember: a(membersService.restoreMember as Fn),
  purgeMember: {
    fn: (async (dbUnknown: unknown, actor: ServiceActor, memberId: string) => {
      const db = dbUnknown as Db;
      const before = membersService.getMemberRowById(db, memberId);
      const photoMeta =
        before?.photo_file_id != null
          ? (() => {
              try {
                return filesService.getFileMeta(db as never, String(before.photo_file_id));
              } catch {
                return null;
              }
            })()
          : null;
      await membersService.purgeMember(db, actor, memberId);
      if (photoMeta) filesService.unlinkFileBytes(photoMeta);
    }) as Fn,
    actor: true,
  },
  listTrashedMembers: a(membersService.listTrashedMembers as Fn),
  setMemberPhoto: {
    fn: ((dbUnknown: unknown, actor: ServiceActor, memberId: string, fileId: string) => {
      const db = dbUnknown as Db;
      requirePermission(actor, "members.edit");
      const row = membersService.getMemberRowById(db, memberId);
      if (!row) throw errNotFound("errors.memberNotFound");
      const meta = filesService.getFileMeta(db as never, fileId);
      if (meta.kind !== "member_photo") throw errValidation("errors.file.kindInvalid");
      // Collect the previous photo id before committing; the byte unlink
      // happens AFTER commit so a rollback never strands the registry row.
      const previousPhotoId = row.photo_file_id ? String(row.photo_file_id) : null;
      db.transaction(() => {
        if (previousPhotoId) {
          // delete the registry row only inside the tx; bytes are unlinked
          // after commit by the sweep below.
          db.run("DELETE FROM files WHERE id = ?", [previousPhotoId]);
        }
        db.run("UPDATE members SET photo_file_id = ?, updated_at = ? WHERE id = ?", [
          fileId,
          nowStamp(),
          memberId,
        ]);
        recordAudit(db, actor, "MEMBER_PHOTO_CHANGED", "member", memberId, { fileId });
      });
      if (previousPhotoId) {
        try {
          const prevMeta = filesService.getFileMeta(db as never, previousPhotoId);
          filesService.unlinkFileBytes(prevMeta);
        } catch {
          /* previous photo already gone — sweep will catch up on next boot */
        }
      }
      return membersService.toPublicMember(membersService.getMemberRowById(db, memberId)!);
    }) as Fn,
    actor: true,
  },
  removeMemberPhoto: {
    fn: ((dbUnknown: unknown, actor: ServiceActor, memberId: string) => {
      const db = dbUnknown as Db;
      requirePermission(actor, "members.edit");
      const row = membersService.getMemberRowById(db, memberId);
      if (!row) throw errNotFound("errors.memberNotFound");
      const fileId = row.photo_file_id ? String(row.photo_file_id) : null;
      if (fileId) {
        db.transaction(() => {
          db.run("UPDATE members SET photo_file_id = NULL WHERE id = ?", [memberId]);
          db.run("DELETE FROM files WHERE id = ?", [fileId]);
          recordAudit(db, actor, "MEMBER_PHOTO_CHANGED", "member", memberId, { removed: true });
        });
        try {
          const prevMeta = filesService.getFileMeta(db as never, fileId);
          filesService.unlinkFileBytes(prevMeta);
        } catch {
          /* sweep catches leftovers */
        }
      }
      return membersService.toPublicMember(membersService.getMemberRowById(db, memberId)!);
    }) as Fn,
    actor: true,
  },
});

import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StickyNote } from "lucide-react";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

export function NotesTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState(ctx.member.notes ?? "");
  const [original, setOriginal] = useState(ctx.member.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermission("members.edit")) {
    return permissionDeniedNode(t);
  }

  const dirty = notes !== original;
  const archived = ctx.member.status === "archived";

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.members.update(ctx.member.id, { notes: notes.trim() || null } as never);
      toast("success", t("members.notesSaved"));
      setOriginal(notes);
      ctx.reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t("members.notesTitle")} />
      <div className="space-y-3 px-5 pb-5">
        {archived && (
          <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2 text-[12px] text-amber">
            {t("members.archiveMember")} — {t("common.disabled")}
          </p>
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("members.notesPlaceholder")}
          rows={8}
          disabled={archived || saving}
          className="flex w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm transition-colors focus:border-neon focus:outline-none disabled:opacity-50"
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={onSave} loading={saving} disabled={saving || !dirty || archived}>
            {t("common.save")}
          </Button>
          {dirty && !saving && (
            <Button variant="secondary" onClick={() => setNotes(original)}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
        {!notes && !original && (
          <EmptyState icon={<StickyNote />} title={t("members.notesEmpty")} />
        )}
      </div>
    </Card>
  );
}

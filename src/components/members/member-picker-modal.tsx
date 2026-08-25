import { useEffect, useRef, useState } from "react";
import { UserRoundSearch } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type PublicMember } from "@/api";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";

interface MemberPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (member: PublicMember) => void;
}

export function MemberPickerModal({ open, onClose, onSelect }: MemberPickerModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PublicMember[]>([]);
  const [touched, setTouched] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setResults([]);
      setTouched(false);
      return;
    }
    if (!actor) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      api.members
        .searchPicker(term)
        .then((items) => {
          setResults(items);
          setTouched(true);
        })
        .catch((err) => {
          console.error("MemberPicker search error:", err);
          setResults([]);
          setTouched(true);
        });
    }, 250);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [term, open, actor]);

  return (
    <Modal open={open} onClose={onClose} title={t("subs.pickMember")} widthClass="max-w-md">
      <div className="space-y-3">
        <SearchInput
          value={term}
          onValueChange={setTerm}
          placeholder={t("members.searchPh")}
          autoFocus
        />
        {results.length === 0 ? (
          <EmptyState icon={<UserRoundSearch />} title={touched ? t("members.emptyTitle") : t("common.search")} />
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto pe-1">
            {results.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(member);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-start transition-colors hover:border-neon/50 hover:bg-white/[0.04]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{member.fullName}</span>
                    <span dir="ltr" className="block text-[11px] text-faint tabnum">
                      {member.memberCode}{member.phone ? ` · ${member.phone}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

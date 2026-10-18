import type { PublicMember } from "@/core/services/members.service";
import type { MemberOverview } from "@/core/services/member-profile.service";

export type TabKey =
  | "overview"
  | "membership"
  | "payments"
  | "attendance"
  | "pt-classes"
  | "notes"
  | "activity"
  | "referrals"
  | "loyalty";

export interface MemberProfileContext {
  member: PublicMember;
  overview: MemberOverview | null;
  reloadTick: number;
  reload: () => void;
  onAddSubscription: (category?: "gym" | "academy") => void;
}

export interface TabProps {
  ctx: MemberProfileContext;
}

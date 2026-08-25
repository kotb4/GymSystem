import type { TFunction } from "@/i18n";
import type { EffectiveSubscriptionStatus } from "@/core/services/subscriptions.service";
import type { CardStatus } from "@/core/services/cards.service";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "violet" | "neutral";

const SUB_VARIANT: Record<EffectiveSubscriptionStatus, BadgeVariant> = {
  active: "success",
  upcoming: "info",
  expired: "danger",
  suspended: "warning",
  cancelled: "violet",
};

const CARD_VARIANT: Record<CardStatus, BadgeVariant> = {
  available: "info",
  assigned: "success",
  lost: "danger",
  blocked: "warning",
};

const MEMBER_VARIANT: Record<"active" | "inactive" | "suspended" | "archived", BadgeVariant> = {
  active: "success",
  inactive: "neutral",
  suspended: "warning",
  archived: "violet",
};

export function subStatusMeta(t: TFunction, status: EffectiveSubscriptionStatus) {
  return { label: t(`status.${status}`), variant: SUB_VARIANT[status] };
}

export function cardStatusMeta(t: TFunction, status: CardStatus) {
  return { label: t(`cards.status${status.charAt(0).toUpperCase()}${status.slice(1)}`), variant: CARD_VARIANT[status] };
}

export function memberStatusMeta(
  t: TFunction,
  status: "active" | "inactive" | "suspended" | "archived"
): { label: string; variant: BadgeVariant } {
  return { label: t(`status.${status}`), variant: MEMBER_VARIANT[status] };
}

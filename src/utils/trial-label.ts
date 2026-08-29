import { TRIAL_TYPES } from "@/api";

const TRIAL_TYPES_SET = new Set<string>(TRIAL_TYPES);

/**
 * Trial-authorized check-ins carry a backend plan name of the form
 * `trial:<trialType>` (e.g. `trial:day_3`). Render them with the localized
 * trial-type label; anything else passes through unchanged.
 */
export function trialPlanLabel(
  planName: string | null | undefined,
  t: (key: string) => string,
): string | null {
  if (!planName) return null;
  if (planName.startsWith("trial:")) {
    const type = planName.slice("trial:".length);
    if (TRIAL_TYPES_SET.has(type)) {
      return t(`trialsTab.type_${type}`);
    }
    return t("trialsTab.title");
  }
  return planName;
}

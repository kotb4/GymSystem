import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Consumes the `focusRowId` handed over by the reference-number search.
 *
 * The header lookup navigates with `state: { focusRowId, focusDocNo }`; this
 * returns the id for a specified duration (defaults to 5 seconds / 5000ms)
 * and clears it afterwards so the row highlight smoothly expires.
 */
export function useFocusRow(durationMs = 5000): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [focusRowId, setFocusRowId] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as { focusRowId?: unknown } | null;
    const id = typeof state?.focusRowId === "string" ? state.focusRowId : null;
    if (id) {
      setFocusRowId(id);
      navigate(location.pathname, { replace: true, state: null });
      const timer = window.setTimeout(() => {
        setFocusRowId(null);
      }, durationMs);
      return () => {
        window.clearTimeout(timer);
      };
    }
    // Intentionally keyed on location.state only so each new navigation triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, durationMs]);

  return focusRowId;
}

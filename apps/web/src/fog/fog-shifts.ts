import type { FogMap } from "@viva/contracts";

/** How far a tile's fog must move to count as rolling in or clearing, ignoring float noise. */
const FOG_CHANGE_EPSILON = 0.01;

export type FogShift = "in" | "out";

/** Which files gained or lost fog between two responses. Files new to the map don't count. */
export const fogShifts = (before: FogMap | null, after: FogMap): ReadonlyMap<string, FogShift> => {
  const shifts = new Map<string, FogShift>();
  if (!before) return shifts;
  const earlier = new Map(before.nodes.map((n) => [n.id, n.fog]));
  for (const { id, fog } of after.nodes) {
    const was = earlier.get(id);
    if (was === undefined || Math.abs(fog - was) < FOG_CHANGE_EPSILON) continue;
    shifts.set(id, fog > was ? "in" : "out");
  }
  return shifts;
};


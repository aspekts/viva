import type { FogMap } from "@viva/contracts";

const FOG_ROLLED_IN = 1;
const FOG_CLEARED = 0.05;

/**
 * The sample map after `step` ticks of the ?mock&roll demo. Tick 0 is the sample
 * as is. Then one file at a time, in map order, an agent writes code (fog rolls in)
 * and a viva passes (fog clears), looping forever.
 */
export const rollFog = (sample: FogMap, step: number): FogMap => {
  const fogs = sample.nodes.map((n) => n.fog);
  for (let tick = 1; tick <= step && fogs.length > 0; tick++) {
    const file = Math.floor((tick - 1) / 2) % fogs.length;
    fogs[file] = tick % 2 === 1 ? FOG_ROLLED_IN : FOG_CLEARED;
  }
  const nodes = sample.nodes.map((n, i) => ({ ...n, fog: fogs[i] ?? n.fog }));
  const debt = sample.nodes.length
    ? sample.debt * (nodes.reduce((sum, n) => sum + n.fog, 0) / sample.nodes.reduce((sum, n) => sum + n.fog, 0))
    : sample.debt;
  return { ...sample, nodes, debt };
};

import type { FogNode } from "@viva/contracts";

/** Mastery at or above this counts as understanding a file, so a glance at it doesn't. */
export const UNDERSTANDS_AT = 0.5;

const HUE_DEGREES = 360;
const GOLDEN_ANGLE = 137.508;

/** The team keeps the same colour in every view. Anyone else gets one from their name. */
const TEAM_HUES: Readonly<Record<string, number>> = {
  kay: 8,
  marcus: 215,
  sophina: 145,
  pedro: 38,
};

const hashName = (name: string): number =>
  [...name].reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0, 7);

const hueOf = (name: string): number => {
  const key = name.trim().toLowerCase();
  return TEAM_HUES[key] ?? (hashName(key) * GOLDEN_ANGLE) % HUE_DEGREES;
};

/** Every name gets a colour, the same one each time, dark enough to read against paper. */
export const teammateColour = (name: string): string => `hsl(${Math.round(hueOf(name))} 55% 42%)`;

/** The people who understand a file, best first. */
export const understanders = (node: FogNode): string[] =>
  node.knownBy
    .filter((k) => k.mastery >= UNDERSTANDS_AT)
    .sort((a, b) => b.mastery - a.mastery)
    .map((k) => k.person);

/** The one person who understands a file, or undefined if it's nobody or several. */
export const soleOwner = (node: FogNode): string | undefined => {
  const people = understanders(node);
  return people.length === 1 ? people[0] : undefined;
};

/** Everyone who appears in the map, in a stable order, for the legend. */
export const teamOf = (nodes: readonly FogNode[]): string[] =>
  [...new Set(nodes.flatMap((n) => n.knownBy.map((k) => k.person)))].sort((a, b) => a.localeCompare(b));

import { describe, expect, it } from "vitest";
import type { FogMap } from "@viva/contracts";
import { fogShifts } from "./fog-shifts";

const mapOf = (fogs: Record<string, number>): FogMap => ({
  repoPath: "/demo",
  generatedAt: "2026-11-08T00:00:00.000Z",
  debt: 0,
  nodes: Object.entries(fogs).map(([id, fog]) => ({
    id, file: id, symbol: null, size: 100, blastRadius: 1, fog, knownBy: [],
  })),
});

describe("fogShifts", () => {
  it("reports nothing on the first response", () => {
    expect(fogShifts(null, mapOf({ a: 1 })).size).toBe(0);
  });

  it("marks fog rolling in and clearing", () => {
    const shifts = fogShifts(mapOf({ a: 0.1, b: 0.9 }), mapOf({ a: 0.8, b: 0.2 }));
    expect(shifts.get("a")).toBe("in");
    expect(shifts.get("b")).toBe("out");
  });

  it("ignores tiny changes and files new to the map", () => {
    const shifts = fogShifts(mapOf({ a: 0.5 }), mapOf({ a: 0.505, c: 1 }));
    expect(shifts.size).toBe(0);
  });
});

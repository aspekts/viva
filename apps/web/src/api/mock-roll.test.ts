import { describe, expect, it } from "vitest";
import type { FogMap } from "@viva/contracts";
import { rollFog } from "./mock-roll";

const sample: FogMap = {
  repoPath: "/demo",
  generatedAt: "2026-11-08T00:00:00.000Z",
  debt: 100,
  nodes: ["a", "b"].map((id) => ({ id, file: id, symbol: null, size: 1, blastRadius: 1, fog: 0.5, knownBy: [] })),
};

const fogAt = (step: number) => rollFog(sample, step).nodes.map((n) => n.fog);

describe("rollFog", () => {
  it("starts as the sample", () => expect(fogAt(0)).toEqual([0.5, 0.5]));

  it("rolls fog onto one file, then clears it, then moves on", () => {
    expect(fogAt(1)).toEqual([1, 0.5]);
    expect(fogAt(2)).toEqual([0.05, 0.5]);
    expect(fogAt(3)).toEqual([0.05, 1]);
  });

  it("loops back to the first file", () => expect(fogAt(5)).toEqual([1, 0.05]));

  it("moves debt with the fog", () => {
    expect(rollFog(sample, 1).debt).toBeGreaterThan(sample.debt);
    expect(rollFog(sample, 2).debt).toBeLessThan(sample.debt);
  });
});

import { describe, expect, it } from "vitest";
import type { FogNode } from "@viva/contracts";
import { soleOwner, teamOf, teammateColour, understanders } from "./teammates";

const nodeOf = (knownBy: FogNode["knownBy"]): FogNode => ({
  id: "a.ts", file: "a.ts", symbol: null, size: 1, blastRadius: 1, fog: 0.3, knownBy,
});

describe("teammateColour", () => {
  it("gives a name the same colour every time, whatever its case", () => {
    expect(teammateColour("Kay")).toBe(teammateColour("kay "));
  });

  it("gives names nobody planned for a colour too", () => {
    expect(teammateColour("Zoltan")).toMatch(/^hsl\(\d+ 55% 42%\)$/);
    expect(teammateColour("Zoltan")).toBe(teammateColour("Zoltan"));
  });

  it("tells the team apart", () => {
    const colours = ["Kay", "Marcus", "Sophina", "Pedro"].map(teammateColour);
    expect(new Set(colours).size).toBe(4);
  });

  it("copes with an empty name", () => {
    expect(teammateColour("")).toMatch(/^hsl\(/);
  });
});

describe("understanders and soleOwner", () => {
  it("lists those at or above the threshold, best first", () => {
    const node = nodeOf([{ person: "Pedro", mastery: 0.6 }, { person: "Sophina", mastery: 0.9 }, { person: "Kay", mastery: 0.45 }]);
    expect(understanders(node)).toEqual(["Sophina", "Pedro"]);
    expect(soleOwner(node)).toBeUndefined();
  });

  it("names the sole owner of a file only one person understands", () => {
    expect(soleOwner(nodeOf([{ person: "Marcus", mastery: 0.8 }, { person: "Kay", mastery: 0.2 }]))).toBe("Marcus");
  });

  it("has no sole owner when nobody understands it", () => {
    expect(soleOwner(nodeOf([]))).toBeUndefined();
  });
});

describe("teamOf", () => {
  it("lists each person once, sorted", () => {
    const nodes = [nodeOf([{ person: "Pedro", mastery: 1 }]), nodeOf([{ person: "Kay", mastery: 1 }, { person: "Pedro", mastery: 1 }])];
    expect(teamOf(nodes)).toEqual(["Kay", "Pedro"]);
  });
});

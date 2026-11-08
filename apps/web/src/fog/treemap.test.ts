import { describe, expect, it } from "vitest";
import { layoutTreemap, type Rect } from "./treemap";

const BOUNDS: Rect = { x: 0, y: 0, w: 100, h: 60 };
const area = (r: Rect) => r.w * r.h;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 1e-9 &&
  b.x < a.x + a.w - 1e-9 &&
  a.y < b.y + b.h - 1e-9 &&
  b.y < a.y + a.h - 1e-9;

describe("layoutTreemap", () => {
  it("returns nothing for no items", () => {
    expect(layoutTreemap([], BOUNDS)).toEqual([]);
  });

  it("gives a single item the whole area", () => {
    const [only] = layoutTreemap([{ key: "a", weight: 5 }], BOUNDS);
    expect(only?.rect).toEqual(BOUNDS);
  });

  it("fills the bounds exactly with no overlaps", () => {
    const items = [40, 25, 15, 10, 6, 4].map((weight, i) => ({
      key: `n${i}`,
      weight,
    }));
    const tiles = layoutTreemap(items, BOUNDS);

    expect(tiles).toHaveLength(items.length);
    expect(tiles.reduce((sum, t) => sum + area(t.rect), 0)).toBeCloseTo(
      area(BOUNDS),
      6,
    );
    for (const [i, a] of tiles.entries()) {
      for (const b of tiles.slice(i + 1))
        expect(overlaps(a.rect, b.rect)).toBe(false);
    }
  });

  it("sizes tiles in proportion to weight", () => {
    const tiles = layoutTreemap(
      [
        { key: "big", weight: 3 },
        { key: "small", weight: 1 },
      ],
      BOUNDS,
    );
    const big = tiles.find((t) => t.key === "big");
    const small = tiles.find((t) => t.key === "small");
    expect(area(big!.rect) / area(small!.rect)).toBeCloseTo(3, 6);
  });

  it("still draws items whose weight is zero or negative", () => {
    const tiles = layoutTreemap(
      [
        { key: "real", weight: 10 },
        { key: "empty", weight: 0 },
        { key: "bad", weight: -4 },
      ],
      BOUNDS,
    );
    expect(tiles.every((t) => area(t.rect) > 0)).toBe(true);
  });

  it("keeps tiles reasonably square for many similar items", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      key: `n${i}`,
      weight: 10 + (i % 5),
    }));
    for (const { rect } of layoutTreemap(items, BOUNDS)) {
      expect(Math.max(rect.w / rect.h, rect.h / rect.w)).toBeLessThan(4);
    }
  });

  it("treats NaN and Infinity weights as empty instead of corrupting the layout", () => {
    const tiles = layoutTreemap(
      [
        { key: "real", weight: 10 },
        { key: "nan", weight: Number.NaN },
        { key: "inf", weight: Number.POSITIVE_INFINITY },
      ],
      BOUNDS,
    );
    expect(tiles).toHaveLength(3);
    expect(tiles.every((t) => Object.values(t.rect).every(Number.isFinite))).toBe(true);
    expect(tiles.reduce((sum, t) => sum + area(t.rect), 0)).toBeCloseTo(area(BOUNDS), 6);
  });

  it("returns nothing for bounds with no area", () => {
    expect(layoutTreemap([{ key: "a", weight: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
    expect(layoutTreemap([{ key: "a", weight: 1 }], { x: 0, y: 0, w: Number.NaN, h: 10 })).toEqual([]);
  });

  it("keeps every tile inside the bounds", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ key: `n${i}`, weight: i + 1 }));
    for (const { rect } of layoutTreemap(items, BOUNDS)) {
      expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.x + rect.w).toBeLessThanOrEqual(BOUNDS.w + 1e-9);
      expect(rect.y + rect.h).toBeLessThanOrEqual(BOUNDS.h + 1e-9);
    }
  });
});

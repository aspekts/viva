import type { Rect } from "./treemap";

export type LabelDetail = "none" | "name" | "full";

/** Tile sizes are in map units: the map is 100 wide and 56.25 tall, and about 14px a unit on a projector. */
const NAME_MIN = { w: 6, h: 3.8 };
const FULL_MIN = { w: 10, h: 8 };

const fits = (rect: Rect, min: { w: number; h: number }): boolean => rect.w >= min.w && rect.h >= min.h;

/** A tile only says as much as it has room for, so a crowded map reads as shapes, not clipped text. */
export function labelDetail(rect: Rect): LabelDetail {
  if (fits(rect, FULL_MIN)) return "full";
  return fits(rect, NAME_MIN) ? "name" : "none";
}

export function splitPath(file: string): { dir: string; name: string } {
  const slash = file.lastIndexOf("/");
  return { dir: file.slice(0, Math.max(slash, 0)), name: file.slice(slash + 1) };
}

/** Squarified treemap (Bruls, Huizing and van Wijk). Pure maths, so it can be tested without a browser. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapItem {
  key: string;
  weight: number;
}

export interface Tile {
  key: string;
  rect: Rect;
}

/** An item with no weight still gets a sliver, so every file stays on the map. */
const MIN_WEIGHT_SHARE = 0.02;

interface Sized {
  key: string;
  area: number;
}

/** Worst aspect ratio in a row laid along a side of the given length. */
function worstRatio(areas: readonly number[], side: number): number {
  const total = areas.reduce((sum, a) => sum + a, 0);
  const largest = Math.max(...areas);
  const smallest = Math.min(...areas);
  return Math.max(
    (side * side * largest) / (total * total),
    (total * total) / (side * side * smallest),
  );
}

/** Takes items from the front of the queue for as long as the row gets no worse. */
function takeRow(queue: readonly Sized[], side: number): Sized[] {
  const row = [queue[0]!];
  for (const next of queue.slice(1)) {
    const areas = row.map((r) => r.area);
    if (worstRatio([...areas, next.area], side) > worstRatio(areas, side))
      break;
    row.push(next);
  }
  return row;
}

export function layoutTreemap(
  items: readonly TreemapItem[],
  bounds: Rect,
): Tile[] {
  if (items.length === 0) return [];

  const largest = Math.max(...items.map((i) => i.weight), 0);
  const floor = largest > 0 ? largest * MIN_WEIGHT_SHARE : 1;
  const weights = items.map((i) => ({
    key: i.key,
    weight: Math.max(i.weight, floor),
  }));
  const totalWeight = weights.reduce((sum, i) => sum + i.weight, 0);
  const scale = (bounds.w * bounds.h) / totalWeight;
  const queue: Sized[] = weights
    .map((i) => ({ key: i.key, area: i.weight * scale }))
    .sort((a, b) => b.area - a.area);

  const tiles: Tile[] = [];
  let free = bounds;
  let rest: readonly Sized[] = queue;

  while (rest.length > 0) {
    const horizontal = free.w >= free.h;
    const row = takeRow(rest, horizontal ? free.h : free.w);
    const rowArea = row.reduce((sum, r) => sum + r.area, 0);
    const thickness = rowArea / (horizontal ? free.h : free.w);

    let offset = 0;
    for (const { key, area } of row) {
      const length = area / thickness;
      tiles.push({
        key,
        rect: horizontal
          ? { x: free.x, y: free.y + offset, w: thickness, h: length }
          : { x: free.x + offset, y: free.y, w: length, h: thickness },
      });
      offset += length;
    }

    free = horizontal
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    rest = rest.slice(row.length);
  }
  return tiles;
}

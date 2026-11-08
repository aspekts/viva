// Rex, Viva's mascot after the Chrome offline dino, drawn pixel by pixel so the
// buddy ships no third-party artwork. The face changes with the buddy's mood.

export type Mood = "neutral" | "shock" | "pout" | "happy";

interface Series {
  name: string;
}

export interface Sprite {
  name: string;
  series: string;
  colour: string;
  variant: string;
}

export const SERIES: Record<string, Series> = {
  viva: { name: "Viva" },
};

export const SPRITES: Record<string, Sprite> = {
  rex: { name: "Rex", series: "viva", colour: "#1d2433", variant: "Ink" },
  "rex-pen": { name: "Rex", series: "viva", colour: "#c8281e", variant: "Red pen" },
};

export const DEFAULT_CHARACTER = "rex";
export const spriteFor = (key: string): Sprite => SPRITES[key] ?? SPRITES[DEFAULT_CHARACTER]!;

/** 22 x 22. `#` is Rex and `.` is empty. The eye sits at row 2, column 13. */
const BODY = [
  "...........#########..",
  "..........###########.",
  "..........###########.",
  "..........###########.",
  "..........###########.",
  "..........######......",
  "..........#########...",
  "#........######.......",
  "#.......########......",
  "##.....##########.....",
  "###...###########.#...",
  "#################.....",
  ".###############......",
  "..#############.......",
  "...###########........",
  "....#########.........",
  ".....###..###.........",
  ".....##....##.........",
  ".....#......#.........",
  ".....##.....##........",
  "......................",
  "......................",
];

/** Cells cleared for the eye and mouth in each mood. */
const FACE: Record<Mood, [number, number][]> = {
  neutral: [[2, 13]],
  shock: [[1, 13], [1, 14], [2, 13], [2, 14], [4, 18], [4, 19], [4, 20]],
  pout: [[2, 13], [2, 14]],
  happy: [[1, 13], [2, 12], [2, 14]],
};

const requests = new WeakMap<HTMLCanvasElement, object>();

export async function draw(canvas: HTMLCanvasElement, key: string, scale = 5, mood: Mood = "neutral"): Promise<void> {
  const sprite = spriteFor(key);
  const request = {};
  requests.set(canvas, request);
  canvas.width = canvas.height = 32 * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cell = Math.floor((canvas.width - 8) / BODY.length);
  const offset = Math.floor((canvas.width - cell * BODY.length) / 2);
  const holes = new Set(FACE[mood].map(([row, col]) => `${row},${col}`));
  ctx.fillStyle = sprite.colour;
  BODY.forEach((line, row) => {
    [...line].forEach((pixel, col) => {
      if (pixel === "#" && !holes.has(`${row},${col}`)) ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
    });
  });
}

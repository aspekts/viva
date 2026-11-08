// Character atlas, ported from AnimePix: transparent sprite sheets cropped per character.

export type Mood = "neutral" | "shock" | "pout" | "happy";

interface Series {
  name: string;
  src: string;
  /** The sheet size the crops were measured against. The PNGs are larger, so crops scale. */
  size: [number, number];
}

export interface Sprite {
  name: string;
  series: string;
  crop: [number, number, number, number];
  variant: string;
}

export const SERIES: Record<string, Series> = {
  jjk: { name: "Jujutsu Kaisen", src: "/characters/jujutsu-kaisen-transparent.png", size: [720, 948] },
  aot: { name: "Attack on Titan", src: "/characters/attack-on-titan-transparent.png", size: [720, 707] },
  naruto: { name: "Naruto", src: "/characters/naruto-transparent.png", size: [720, 941] },
};

export const SPRITES: Record<string, Sprite> = {};
const add = (key: string, name: string, series: string, crop: Sprite["crop"], variant = "") => {
  SPRITES[key] = { name, series, crop, variant };
};

add("gojo", "Gojo", "jjk", [90, 38, 255, 280]);
add("yuta", "Yuta", "jjk", [375, 30, 235, 290]);
add("megumi", "Megumi", "jjk", [80, 330, 265, 280]);
add("nobara", "Nobara", "jjk", [375, 335, 240, 275]);
add("yuji", "Yuji", "jjk", [80, 610, 265, 280]);
add("toge", "Toge", "jjk", [370, 615, 245, 280]);

const titans = [["eren", "Eren"], ["mikasa", "Mikasa"], ["armin", "Armin"]] as const;
const looks = ["Cadet", "Season 4", "Scout"];
looks.forEach((look, row) =>
  titans.forEach(([key, name], col) => add(`${key}-${row + 1}`, name, "aot", [35 + col * 240, 8 + row * 238, 180, 216], look)));

add("naruto", "Naruto", "naruto", [88, 48, 265, 275]);
add("sakura", "Sakura", "naruto", [355, 68, 245, 255]);
add("sasuke", "Sasuke", "naruto", [88, 330, 250, 270]);
add("kakashi", "Kakashi", "naruto", [355, 335, 250, 270]);
add("obito", "Obito", "naruto", [88, 605, 250, 265]);
add("itachi", "Itachi", "naruto", [350, 610, 235, 265]);

export const DEFAULT_CHARACTER = "gojo";
export const spriteFor = (key: string): Sprite => SPRITES[key] ?? SPRITES[DEFAULT_CHARACTER]!;

const images = new Map<string, Promise<HTMLImageElement>>();
function load(series: string): Promise<HTMLImageElement> {
  let ready = images.get(series);
  if (!ready) {
    const image = new Image();
    ready = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load ${SERIES[series]!.name} artwork`));
    });
    image.src = SERIES[series]!.src;
    images.set(series, ready);
  }
  return ready;
}

const requests = new WeakMap<HTMLCanvasElement, object>();

/** Mood is carried by animation and dialogue; the supplied art stays intact. */
export async function draw(canvas: HTMLCanvasElement, key: string, scale = 5): Promise<void> {
  const sprite = spriteFor(key);
  const request = {};
  requests.set(canvas, request);
  canvas.width = canvas.height = 32 * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    const image = await load(sprite.series);
    if (requests.get(canvas) !== request) return;
    const [x, y, width, height] = sprite.crop;
    const [sheetWidth, sheetHeight] = SERIES[sprite.series]!.size;
    const sx = image.naturalWidth / sheetWidth;
    const sy = image.naturalHeight / sheetHeight;
    const fit = (canvas.height - 12) / Math.max(width, height);
    const dw = width * fit, dh = height * fit;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, x * sx, y * sy, width * sx, height * sy, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  } catch {
    if (requests.get(canvas) !== request) return;
    ctx.fillStyle = "#d8dcec";
    ctx.font = `${Math.max(10, scale * 3)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(sprite.name, canvas.width / 2, canvas.height / 2);
  }
}

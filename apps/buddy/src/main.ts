import type { Answer, Review } from "@viva/contracts";
import { ApiError, examRoomLink, isMockMode, loadReview, skipReview, submitAnswers } from "./api";
import { Buddy, h } from "./buddy";
import { flagsFor, pushStats, riskLevel, sceneFor, tooShort } from "./review";
import { DEFAULT_CHARACTER, SERIES, SPRITES, draw, spriteFor } from "./sprites";
import "./styles.css";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const STORAGE_KEY = "animepix.buddy";

const buddy = new Buddy($("#stage"));
const reviewId = new URLSearchParams(location.search).get("review");
let review: Review | null = null;
/** True while answering or waiting on the daemon, so a background refresh can't swap the scene. */
let engaged = false;

// ---------- the push, behind the buddy ----------

function renderPush(current: Review | null): void {
  const card = $("#push");
  if (!current) {
    card.replaceChildren(
      h("h1", {}, "No risky pushes yet"),
      h("p", { class: "muted" }, "When git push needs a viva, Viva opens this page and your buddy pops up."));
    return;
  }
  const { request } = current;
  const repo = request.repoPath.split(/[\\/]/).filter(Boolean).pop() ?? request.repoPath;
  const stats = pushStats(current);
  card.replaceChildren(
    h("p", { class: "eyebrow" }, `git push · ${repo}`),
    h("h1", {}, current.claims.length ? `${plural(stats.decisions, "decision")} to defend` : "Push review"),
    h("p", { class: "muted mono" }, `${request.person} · ${request.base.slice(0, 7)}..${request.head.slice(0, 7)}`),
    // The intent is the developer's own commit text or agent prompt: shown as text only.
    h("blockquote", { hidden: request.intent ? undefined : "" }, request.intent?.split("\n")[0] ?? ""),
    h("ul", { class: "claims" }, ...current.claims.map((claim) =>
      h("li", {},
        h("span", { class: `origin origin-${claim.origin}` }, claim.origin === "silent" ? "not asked for" : claim.origin),
        h("b", {}, claim.summary),
        h("code", {}, `${claim.location.file}:${claim.location.lines[0]}–${claim.location.lines[1]}`)))),
    h("a", { class: "exam-link", href: examRoomLink(current.id) }, "Open in the full exam room, with the code →"));
}

// ---------- scenes ----------

function riskMeter(percent: number): HTMLElement {
  const level = riskLevel(percent);
  const bar = h("i");
  bar.style.setProperty("--w", `${percent}%`);
  return h("div", { class: "risk", "data-level": level },
    h("span", { class: "risk-label" }, "RISK"),
    h("div", { class: "risk-bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(percent), "aria-label": "Risk score" }, bar),
    h("b", { class: "risk-num" }, String(percent)));
}

const button = (label: string, onClick: () => void, primary = false) =>
  h("button", { type: "button", class: primary ? "px-btn primary" : "px-btn", on: { click: onClick } }, label);

/** Skipping leaves the code under fog, so it takes a second, deliberate click. */
function skipLink(current: Review, label: string): HTMLElement {
  let armed = false;
  const link = h("button", { type: "button", class: "skip" }, label);
  link.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      link.textContent = "Sure? The code stays under fog. Click again to push with debt.";
      return;
    }
    void skip(current);
  });
  return link;
}

function play(current: Review): void {
  review = current;
  renderPush(current);
  const scene = sceneFor(current);
  if (scene.kind === "ask") void ask(current);
  else if (scene.kind === "result") void result(current);
  else void buddy.say("Hmm…", "This review hasn't finished. Run git push again.", "neutral");
}

async function ask(current: Review): Promise<void> {
  const stats = pushStats(current);
  const flags = h("ul", { class: "flags" }, ...flagsFor(current).map((flag) =>
    h("li", { class: flag.silent ? "silent" : "" }, flag.text)));
  await buddy.say("HOLD UP!",
    `${plural(stats.decisions, "risky decision")} in ${plural(stats.files, "file")}… can you defend this push before it ships?`,
    "shock",
    [
      riskMeter(stats.risk),
      flags,
      h("div", { class: "actions" }, button("Defend it", () => void question(current, 0, []), true), button("Let me review", () => void standDown(current))),
      skipLink(current, "I know what I'm doing →"),
    ]);
  if (buddy.root.dataset.mood === "shock") buddy.setMood("neutral");
}

async function question(current: Review, index: number, answers: string[]): Promise<void> {
  const questions = current.plan?.questions ?? [];
  const q = questions[index];
  if (!q) return submit(current, answers);
  engaged = true;
  const last = index === questions.length - 1;
  const box = h("textarea", { id: "buddy-note", rows: "3", placeholder: "Explain it in your own words…" });
  box.value = answers[index] ?? "";
  const next = async () => {
    if (tooShort(box.value)) {
      buddy.setMood("pout");
      Buddy.shake(box);
      box.focus();
      return;
    }
    const kept = [...answers];
    kept[index] = box.value.trim();
    await question(current, index + 1, kept);
  };
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void next();
  });
  await buddy.say(`QUESTION ${index + 1}/${questions.length}`, q.ask, "neutral", [
    h("p", { class: "where" }, `${q.location.file} · lines ${q.location.lines[0]}–${q.location.lines[1]}`),
    h("label", { class: "sr-only", for: "buddy-note" }, "Your answer"),
    box,
    h("div", { class: "actions" },
      button(last ? "Submit answers" : "Next", () => void next(), true),
      index > 0 ? button("Back", () => void question(current, index - 1, answers)) : button("Not now", () => void standDown(current))),
  ]);
  box.focus({ preventScroll: true });
}

async function submit(current: Review, transcripts: string[]): Promise<void> {
  engaged = true;
  const questions = current.plan?.questions ?? [];
  // Every question is sent: a missing answer would score zero.
  const answers: Answer[] = questions.map((q, i) => ({ questionId: q.id, transcript: transcripts[i] ?? "", mode: "typed" }));
  void buddy.say("Marking…", "Let me check that against the rubric. This can take a few seconds.", "neutral");
  try {
    const graded = await submitAnswers(current.id, answers);
    engaged = false;
    play(graded);
  } catch (error) {
    await failure(current, error, () => void submit(current, transcripts));
  }
}

async function skip(current: Review): Promise<void> {
  engaged = true;
  void buddy.say("…okay.", "Pushing with debt.", "pout");
  try {
    const skipped = await skipReview(current.id);
    engaged = false;
    play(skipped);
  } catch (error) {
    await failure(current, error, () => void skip(current));
  }
}

async function failure(current: Review, error: unknown, retry: () => void): Promise<void> {
  engaged = false;
  if (error instanceof ApiError && error.status === 404) {
    await buddy.say("Gone!", "This review is no longer available. Run git push again to start a new one.", "pout");
    return;
  }
  if (error instanceof ApiError && error.status === 409) {
    // Answered or skipped somewhere else, or a hard gate: show whatever the daemon holds now.
    try { play((await loadReview(current.id)) ?? current); } catch { await buddy.say("Hmm…", "Viva changed this review elsewhere. Reload the page.", "pout"); }
    return;
  }
  await buddy.say("Oops", "I couldn't reach Viva. Is the daemon running?", "pout", [
    h("div", { class: "actions" }, button("Try again", retry, true), button("Let me review", () => void standDown(current))),
  ]);
}

async function result(current: Review): Promise<void> {
  const gate = current.gate!;
  const view = sceneFor(current);
  if (view.kind !== "result") return;
  const { title, detail, allowed, canSkip } = view.gate;
  const missed = [...new Set(current.grades.flatMap((grade) => grade.missing))];
  const mood = view.skipped ? "pout" : allowed ? "happy" : gate.skippable ? "pout" : "shock";
  const line = view.skipped
    ? `${detail} Run git push again to send it.`
    : allowed ? `${detail} Run git push again to send it. ✿` : detail;
  await buddy.say(title, line, mood, [
    missed.length && !allowed ? h("p", { class: "where" }, "What your answers missed:") : null,
    missed.length && !allowed ? h("ul", { class: "flags" }, ...missed.map((point) => h("li", {}, point))) : null,
    allowed ? null : h("div", { class: "actions" }, h("a", { class: "px-btn primary", href: examRoomLink(current.id) }, "Open exam room")),
    canSkip ? skipLink(current, "Push anyway, with debt →") : null,
  ]);
}

async function standDown(current: Review): Promise<void> {
  engaged = false;
  await buddy.say("Good call!", "Take your time. The push stays blocked until you're back.", "happy");
  await new Promise((resolve) => setTimeout(resolve, 1300));
  if (review?.id !== current.id) return;
  buddy.hide();
  dock.hidden = false;
}

buddy.onDismiss = () => { if (review && !engaged) void standDown(review); };

const dock = h("button", { type: "button", class: "dock", hidden: "" });
dock.addEventListener("click", () => {
  dock.hidden = true;
  if (review) play(review);
});
$("#stage").append(dock);

// ---------- character picker ----------

function setupPicker(): void {
  let saved = DEFAULT_CHARACTER;
  try { saved = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CHARACTER; } catch { /* Private windows can block storage. */ }
  if (!Object.hasOwn(SPRITES, saved)) saved = DEFAULT_CHARACTER;

  const series = $<HTMLSelectElement>("#buddy-series");
  const picker = $("#picker");
  series.replaceChildren(...Object.entries(SERIES).map(([key, value]) => h("option", { value: key }, value.name)));
  series.value = spriteFor(saved).series;

  const picks = Object.entries(SPRITES).map(([key, sprite]) => {
    const canvas = h("canvas", { "aria-hidden": "true" });
    const pick = h("button", {
      type: "button", class: "pick", "data-series": sprite.series, "aria-pressed": "false",
      "aria-label": `${sprite.name}, ${sprite.variant || SERIES[sprite.series]!.name}`,
      on: { click: () => select(key) },
    }, canvas, h("span", {}, h("b", {}, sprite.name), sprite.variant ? h("small", {}, sprite.variant) : null));
    void draw(canvas, key, 4);
    return [key, pick] as const;
  });
  picker.replaceChildren(...picks.map(([, pick]) => pick));

  const filter = () => { for (const [, pick] of picks) pick.hidden = pick.dataset.series !== series.value; };
  series.addEventListener("change", filter);
  filter();

  function select(key: string): void {
    buddy.setCharacter(key);
    for (const [k, pick] of picks) pick.setAttribute("aria-pressed", String(k === key));
    const sprite = spriteFor(key);
    $("#selected-buddy").textContent = `${sprite.name}${sprite.variant ? ` · ${sprite.variant}` : ""}`;
    dock.textContent = `▶ ${sprite.name} is waiting`;
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* Not remembered, which is fine. */ }
  }
  select(saved);
}

// ---------- start ----------

async function refresh(): Promise<void> {
  if (engaged) return;
  try {
    const loaded = await loadReview(review?.id ?? reviewId);
    if (!loaded) return;
    // Answered in the terminal or the exam room meanwhile: catch up.
    if (!review || loaded.id !== review.id || loaded.stage !== review.stage || loaded.gate?.reason !== review.gate?.reason) {
      dock.hidden = true;
      play(loaded);
    }
  } catch { /* Keep showing what we have. */ }
}

async function start(): Promise<void> {
  setupPicker();
  $("#mock").hidden = !isMockMode;
  try {
    const loaded = await loadReview(reviewId);
    if (loaded) play(loaded);
    else {
      renderPush(null);
      await buddy.say("All clear", "No risky pushes yet. I'll pop up when one needs a viva.", "happy");
    }
  } catch (error) {
    renderPush(null);
    const gone = error instanceof ApiError && error.status === 404;
    await buddy.say(gone ? "Gone!" : "Oops", gone
      ? "Viva has forgotten this review, maybe after a restart. Run git push again."
      : "I couldn't reach Viva. Start it with pnpm dev, then reload.", "pout");
  }
  window.addEventListener("focus", () => void refresh());
}

void start();

// The Viva buddy pop-up (Rex), first built in Sophina's AnimePix mockup, driving a real Viva review. It only renders:
// main.ts decides what to say and what each button does.
import { draw, spriteFor, DEFAULT_CHARACTER, type Mood } from "./sprites";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Child = Node | string | null | undefined | false;
type Props = { on?: Record<string, (event: Event) => void> } & { [attribute: string]: string | undefined | Props["on"] };

/** Builds elements with text content only, so repository text can never become markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { on, ...attrs } = props;
  for (const [key, value] of Object.entries(attrs)) if (typeof value === "string") node.setAttribute(key, value);
  for (const [event, handler] of Object.entries(on ?? {})) node.addEventListener(event, handler);
  for (const child of children) if (child) node.append(child);
  return node;
}

export class Buddy {
  character = DEFAULT_CHARACTER;
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private typing: object | null = null;
  /** Called by the close button and Escape. */
  onDismiss: () => void = () => {};

  constructor(host: HTMLElement) {
    this.titleEl = h("span", { class: "bubble-title", id: "buddy-title" });
    this.textEl = h("p", { class: "bubble-text", "aria-live": "polite" });
    this.bodyEl = h("div", { class: "bubble-body" });
    this.canvas = h("canvas", { class: "buddy-sprite", "aria-hidden": "true" });
    this.nameEl = h("span", { class: "buddy-name" });
    this.root = h("div", { class: "buddy", "data-state": "hidden", role: "dialog", "aria-modal": "false", "aria-labelledby": "buddy-title" },
      h("div", { class: "bubble" },
        h("div", { class: "bubble-head" },
          this.titleEl,
          h("button", { class: "bubble-x", type: "button", "aria-label": "Close and review first", on: { click: () => this.onDismiss() } }, "×")),
        this.textEl,
        this.bodyEl),
      h("div", { class: "buddy-figure" },
        h("span", { class: "buddy-alert", "aria-hidden": "true" }, "!"),
        this.canvas,
        this.nameEl));
    this.root.addEventListener("keydown", (event) => { if (event.key === "Escape") this.onDismiss(); });
    host.append(this.root);
    this.render();
  }

  get name(): string { return spriteFor(this.character).name; }
  get isOpen(): boolean { return this.root.dataset.state === "open"; }

  setCharacter(key: string): void {
    this.character = key;
    this.render();
  }

  setMood(mood: Mood): void {
    this.root.dataset.mood = mood;
    this.render();
  }

  private render(): void {
    void draw(this.canvas, this.character, 5, (this.root?.dataset.mood as Mood | undefined) ?? "neutral");
    this.nameEl.textContent = this.name;
  }

  open(): void { this.root.dataset.state = "open"; }
  hide(): void { this.root.dataset.state = "hidden"; }

  /** Swaps the bubble's contents and types the line. Resolves once it has finished typing. */
  async say(title: string, text: string, mood: Mood, body: Child[] = []): Promise<void> {
    const wasOpen = this.isOpen;
    this.open();
    this.setMood(mood);
    this.titleEl.textContent = title;
    this.bodyEl.replaceChildren(...body.filter((child): child is Node | string => !!child));
    // Let the pop-up animation land before the first line types.
    if (!wasOpen && !reduceMotion) await sleep(420);
    await this.type(text);
  }

  private async type(text: string): Promise<void> {
    const token = (this.typing = {});
    if (reduceMotion) { this.textEl.textContent = text; return; }
    this.textEl.textContent = "";
    for (const ch of text) {
      if (this.typing !== token) return;
      this.textEl.textContent += ch;
      await sleep(ch === "." || ch === "?" || ch === "!" ? 120 : 16);
    }
  }

  /** Wobbles an element, for a too-short answer. */
  static shake(node: HTMLElement): void {
    node.classList.remove("shake");
    void node.offsetWidth;
    node.classList.add("shake");
  }
}

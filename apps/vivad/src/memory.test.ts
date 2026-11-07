import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SavedMemory } from "@viva/contracts";
import saved from "../../../fixtures/mock/memory.json";
import { formatMemory, formatSaved, repoRelative } from "./memory.js";

describe("viva memory", () => {
  const { entries } = SavedMemory.parse(saved);

  it("names files as git does, from any directory and on any OS", () => {
    const root = join("/", "repo");
    expect(repoRelative(root, join(root, "src"), "webhook.ts")).toBe("src/webhook.ts");
    expect(repoRelative(root, root, join("src", "webhook.ts"))).toBe("src/webhook.ts");
  });

  it("hands recorded reasoning to agents as data", () => {
    const text = formatMemory("src/webhook.ts", entries);
    expect(text).toContain(".viva/memory/src/webhook.ts.md");
    expect(text).toMatch(/<untrusted name="viva-memory">[\s\S]*check stays first on purpose[\s\S]*<\/untrusted>/);
    expect(formatMemory("src/other.ts", [])).toBe("viva: no saved reasoning for src/other.ts.");
  });

  it("shows the developer exactly what was saved and how to share it", () => {
    const text = formatSaved(SavedMemory.parse(saved));
    expect(text).toContain("saved 1 explanation(s) to .viva/memory/src/webhook.ts.md");
    expect(text).toContain("commit the file");
    expect(text).toContain(entries[0]!.explanation);
  });
});

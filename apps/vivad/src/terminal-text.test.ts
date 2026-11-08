import { expect, it } from "vitest";
import { terminalText } from "./terminal-text.js";

it("strips ANSI CSI, OSC and C0/C1 controls while preserving newlines and Unicode", () => {
  expect(terminalText("\x1b[2JQuestion\x1b[0m\n\x1b]0;owned\x07café\x00\x08\x09\x0d\x7f\x85\x9b31m!"))
    .toBe("Question\ncafé!");
  expect(terminalText("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\" )).toBe("link");
});

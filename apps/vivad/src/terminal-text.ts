import { stripVTControlCharacters } from "node:util";

/** Untrusted model/repository prose must never control the terminal. Keep only LF. */
export function terminalText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}

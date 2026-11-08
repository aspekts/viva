import { describe, expect, it } from "vitest";
import { labelDetail, splitPath } from "./tile-label";

describe("splitPath", () => {
  it("separates the file name from its folder", () => {
    expect(splitPath("apps/web/src/exam/ExamRoom.tsx")).toEqual({ dir: "apps/web/src/exam", name: "ExamRoom.tsx" });
  });

  it("has no folder for a file at the root", () => {
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });
});

describe("labelDetail", () => {
  it("shows nothing on a tile too small to hold text, instead of a clipped path", () => {
    expect(labelDetail({ x: 0, y: 0, w: 3, h: 2 })).toBe("none");
    expect(labelDetail({ x: 0, y: 0, w: 20, h: 2 })).toBe("none");
    expect(labelDetail({ x: 0, y: 0, w: 3, h: 20 })).toBe("none");
  });

  it("shows only the file name on a small tile", () => {
    expect(labelDetail({ x: 0, y: 0, w: 8, h: 5 })).toBe("name");
  });

  it("shows the folder and who understands it on a big tile", () => {
    expect(labelDetail({ x: 0, y: 0, w: 12, h: 10 })).toBe("full");
  });
});

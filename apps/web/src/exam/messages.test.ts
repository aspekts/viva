import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { loadErrorMessage, submitErrorMessage } from "./messages";

describe("loadErrorMessage", () => {
  it("tells the person to push again on a 404", () => {
    expect(loadErrorMessage(new ApiError("gone", 404))).toContain("git push");
  });

  it("points at the daemon for any other failure", () => {
    expect(loadErrorMessage(new ApiError("boom", 500))).toContain("daemon");
    expect(loadErrorMessage(new TypeError("network"))).toContain("daemon");
  });
});

describe("submitErrorMessage", () => {
  it("tells the person to push again on a 404, because retrying cannot work", () => {
    expect(submitErrorMessage(new ApiError("gone", 404))).toContain("git push");
  });

  it("says the exam is finished on a 409", () => {
    expect(submitErrorMessage(new ApiError("done", 409))).toContain("already finished");
  });

  it("allows a retry for other failures", () => {
    expect(submitErrorMessage(new ApiError("boom", 500))).toContain("Try again");
  });
});

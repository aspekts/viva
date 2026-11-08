import { ApiError } from "../api/errors";

const RUN_PUSH_AGAIN = "This review is no longer available. Run `git push` again to start a new one.";

export const loadErrorMessage = (error: unknown): string =>
  error instanceof ApiError && error.status === 404
    ? RUN_PUSH_AGAIN
    : "Could not load this review. Check that the daemon is running, then try again.";

/** Retrying cannot help after a 404 (the daemon restarted) or a 409 (already graded). */
export const submitErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 404) return RUN_PUSH_AGAIN;
  if (error instanceof ApiError && error.status === 409) {
    return "This exam is already finished. Reload the page to see the result.";
  }
  return "Could not submit your answers. Try again.";
};

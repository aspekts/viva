import { useEffect, useState } from "react";
import type { CodeLocation, ReviewCode } from "@viva/contracts";
import { getReviewCode } from "../api/client";

/**
 * The lines under discussion, marking the ones asked about. Deliberately unstyled,
 * as Sophina owns the look. If the code can't be loaded, the path stays as the fallback.
 */
export function QuestionCode({ reviewId, location }: { reviewId: string; location: CodeLocation }) {
  const [code, setCode] = useState<ReviewCode | null>(null);
  const [start, end] = location.lines;

  useEffect(() => {
    let current = true;
    getReviewCode(reviewId, { file: location.file, lines: [start, end] }).then(
      (loaded) => { if (current) setCode(loaded); },
      () => { if (current) setCode(null); },
    );
    return () => { current = false; };
  }, [reviewId, location.file, start, end]);

  if (!code) return null;
  return (
    <pre>
      <code>
        {code.lines.map(({ number, text, focus }) => {
          const line = `${number}  ${text}\n`;
          return focus ? <mark key={number}>{line}</mark> : <span key={number}>{line}</span>;
        })}
      </code>
    </pre>
  );
}

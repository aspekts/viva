import { useState } from "react";
import { ExamRoom } from "./exam/ExamRoom";
import { FogView } from "./fog/FogView";

type View = "fog" | "exam";

export function App() {
  const reviewId = new URLSearchParams(location.search).get("review");
  const [view, setView] = useState<View>(reviewId ? "exam" : "fog");

  return (
    <main>
      <nav>
        <strong>Viva</strong>
        <button aria-pressed={view === "fog"} onClick={() => setView("fog")}>
          The Fog
        </button>
        <button aria-pressed={view === "exam"} onClick={() => setView("exam")}>
          Exam room
        </button>
      </nav>
      {view === "fog" ? <FogView /> : <ExamRoom reviewId={reviewId} />}
    </main>
  );
}

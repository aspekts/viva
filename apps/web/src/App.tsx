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
      {/* Both stay mounted, so typed answers survive a trip to the Fog. */}
      <div hidden={view !== "fog"}>
        <FogView />
      </div>
      <div hidden={view !== "exam"}>
        <ExamRoom reviewId={reviewId} />
      </div>
    </main>
  );
}

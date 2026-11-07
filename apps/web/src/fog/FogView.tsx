import { useEffect, useState } from "react";
import type { FogMap } from "@viva/contracts";
import { getFog } from "../api/client";

/** Placeholder map, showing the data shape. Kay owns the real visual. */
export function FogView() {
  const [map, setMap] = useState<FogMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFog().then(setMap, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert">Could not load the map: {error}. Add ?mock to the URL to use sample data.</p>;
  if (!map) return <p>Loading the map…</p>;

  const sorted = [...map.nodes].sort((a, b) => b.size - a.size);
  return (
    <section>
      <h1>Comprehension debt: {Math.round(map.debt).toLocaleString()}</h1>
      <div className="fog-grid">
        {sorted.map((node) => (
          <article
            key={node.id}
            className="fog-node"
            style={{ flexGrow: Math.max(1, Math.sqrt(node.size)), "--fog": node.fog } as React.CSSProperties}
          >
            <span>{node.file}</span>
            <small>{node.knownBy.length ? node.knownBy.map((k) => k.person).join(", ") : "Understood by nobody"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

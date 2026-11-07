import { useEffect, useMemo, useState } from "react";
import type { FogMap, FogNode } from "@viva/contracts";
import { getFog } from "../api/client";
import { layoutTreemap, type Rect } from "./treemap";

/** The map is laid out in a 16:9 box, then drawn in percentages so it scales to any screen. */
const MAP: Rect = { x: 0, y: 0, w: 100, h: 56.25 };

/** File sizes vary hugely, so the square root keeps one big file from hiding the rest. */
const tileWeight = (node: FogNode): number => Math.sqrt(node.size);

const percent = (value: number): string => `${value}%`;

const knownByLabel = (node: FogNode): string =>
  node.knownBy.length > 0
    ? node.knownBy.map((k) => k.person).join(", ")
    : "Understood by nobody";

const nodeName = (node: FogNode): string => (node.symbol ? `${node.file} › ${node.symbol}` : node.file);

const fogLabel = (node: FogNode): string =>
  `${Math.round(node.fog * 100)}% fog`;

interface FogTileProps {
  node: FogNode;
  rect: Rect;
}

const FogTile = ({ node, rect }: FogTileProps) => (
  <article
    className="fog-node"
    tabIndex={0}
    aria-label={`${nodeName(node)}. ${fogLabel(node)}. ${knownByLabel(node)}.`}
    title={`${node.file}\n${fogLabel(node)}\n${knownByLabel(node)}`}
    style={
      {
        left: percent(rect.x),
        top: percent((rect.y / MAP.h) * 100),
        width: percent(rect.w),
        height: percent((rect.h / MAP.h) * 100),
        "--fog": node.fog,
      } as React.CSSProperties
    }
  >
    <div className="fog-label">
      <span className="fog-file">{nodeName(node)}</span>
      <small>{knownByLabel(node)}</small>
    </div>
  </article>
);

/** Code nobody has shown they understand sits under fog. The clearer the tile, the better it is understood. */
export function FogView() {
  const [map, setMap] = useState<FogMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFog().then(setMap, (e: Error) => setError(e.message));
  }, []);

  const tiles = useMemo(
    () =>
      map
        ? layoutTreemap(
            map.nodes.map((n, index) => ({ key: String(index), weight: tileWeight(n) })),
            MAP,
          )
        : [],
    [map],
  );

  if (error)
    return (
      <p role="alert">
        Could not load the map: {error}. Add ?mock to the URL to use sample
        data.
      </p>
    );
  if (!map) return <p>Loading the map…</p>;

  return (
    <section>
      <header className="fog-header">
        <h1>Comprehension debt: {Math.round(map.debt).toLocaleString()}</h1>
        <p className="fog-legend">
          <span className="fog-swatch fog-swatch-clear" aria-hidden="true" /> understood
          <span className="fog-swatch fog-swatch-fog" aria-hidden="true" /> understood by nobody
        </p>
      </header>
      {map.nodes.length === 0 ? (
        <p>
          No files mapped yet. Push a change, or add ?mock to see sample data.
        </p>
      ) : (
        <div className="fog-map">
          {tiles.map(({ key, rect }) => {
            const node = map.nodes[Number(key)];
            return node ? <FogTile key={key} node={node} rect={rect} /> : null;
          })}
        </div>
      )}
    </section>
  );
}

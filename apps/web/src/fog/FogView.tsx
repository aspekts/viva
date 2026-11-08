import { useEffect, useMemo, useRef, useState } from "react";
import type { FogMap, FogNode } from "@viva/contracts";
import { getFog, watch } from "../api/client";
import { fogShifts, type FogShift } from "./fog-shifts";
import { soleOwner, teamOf, teammateColour, understanders } from "./teammates";
import { labelDetail, splitPath } from "./tile-label";
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
  shift: FogShift | undefined;
  busFactor: boolean;
}

const FogTile = ({ node, rect, shift, busFactor }: FogTileProps) => {
  const owner = soleOwner(node);
  const best = understanders(node)[0];
  const detail = labelDetail(rect);
  const { dir, name } = splitPath(node.file);
  const busFactorNote = owner ? ` Only ${owner} understands this.` : "";
  return (
  <article
    className="fog-node"
    data-shift={shift}
    data-owner={best ? "" : undefined}
    data-sole-owner={owner ? "" : undefined}
    data-dim={busFactor && !owner ? "" : undefined}
    tabIndex={0}
    aria-label={`${nodeName(node)}. ${fogLabel(node)}. ${knownByLabel(node)}.${busFactorNote}`}
    title={`${node.file}\n${fogLabel(node)}\n${knownByLabel(node)}`}
    style={
      {
        left: percent(rect.x),
        top: percent((rect.y / MAP.h) * 100),
        width: percent(rect.w),
        height: percent((rect.h / MAP.h) * 100),
        "--fog-level": node.fog,
        "--owner": best ? teammateColour(best) : undefined,
      } as React.CSSProperties
    }
  >
    {detail !== "none" && (
      <div className="fog-label">
        <span className="fog-file">{node.symbol ? `${name} › ${node.symbol}` : name}</span>
        {detail === "full" && (
          <>
            {dir && <small>{dir}</small>}
            <small>
              {node.knownBy.map((k) => (
                <span key={k.person} className="fog-dot" style={{ background: teammateColour(k.person) }} aria-hidden="true" />
              ))}
              {knownByLabel(node)}
            </small>
            {owner && <strong className="fog-sole">Only {owner}</strong>}
          </>
        )}
      </div>
    )}
  </article>
  );
};

/** Code nobody has shown they understand sits under fog. The clearer the tile, the better it is understood. */
export function FogView() {
  const [map, setMap] = useState<FogMap | null>(null);
  const [shifts, setShifts] = useState<ReadonlyMap<string, FogShift>>(new Map());
  const previous = useRef<FogMap | null>(null);
  const [busFactor, setBusFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => getFog().then((loaded) => {
        setShifts(fogShifts(previous.current, loaded));
        previous.current = loaded;
        setMap(loaded);
        setError(null);
      }, (e: Error) => setError(e.message));
    load();
    return watch("fog", load);
  }, []);

  const tiles = useMemo(
    () =>
      map
        ? layoutTreemap(
            map.nodes.map((n) => ({ key: n.id, weight: tileWeight(n) })),
            MAP,
          )
        : [],
    [map],
  );

  const nodesById = useMemo(() => new Map((map?.nodes ?? []).map((n) => [n.id, n])), [map]);

  if (error)
    return (
      <p role="alert">
        Could not load the map: {error}. Add ?mock to the URL to use sample
        data.
      </p>
    );
  if (!map) return <p>Loading the map…</p>;
  if (!map.repoPath) return <p>No repo to map yet. Push from a repo with the Viva hook installed, and it appears here.</p>;

  return (
    <section>
      <header className="fog-header">
        <h1>Comprehension debt: {Math.round(map.debt).toLocaleString()}</h1>
        <p className="fog-legend">
          <span className="fog-swatch fog-swatch-clear" aria-hidden="true" /> understood
          <span className="fog-swatch fog-swatch-fog" aria-hidden="true" /> understood by nobody
        </p>
      </header>
      <div className="fog-controls">
        <button type="button" aria-pressed={busFactor} onClick={() => setBusFactor((on) => !on)}>
          Bus factor
        </button>
        <ul className="fog-team" aria-label="Teammates">
          {teamOf(map.nodes).map((person) => (
            <li key={person}>
              <span className="fog-dot" style={{ background: teammateColour(person) }} aria-hidden="true" />
              {person}
            </li>
          ))}
        </ul>
      </div>
      {map.nodes.length === 0 ? (
        <p>
          No files mapped yet. Push a change, or add ?mock to see sample data.
        </p>
      ) : (
        <div className="fog-map">
          {tiles.map(({ key, rect }) => {
            const node = nodesById.get(key);
            return node ? <FogTile key={key} node={node} rect={rect} shift={shifts.get(key)} busFactor={busFactor} /> : null;
          })}
        </div>
      )}
    </section>
  );
}

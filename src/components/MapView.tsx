import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, LineString, MultiLineString, Position } from 'geojson';
import type { RouteFeature } from '../types';

interface Props {
  data: FeatureCollection | null;
  routes: RouteFeature[];
  selected: RouteFeature | null;
  /** Called with a route index when a route is clicked, or null when empty map space is clicked. */
  onSelect: (idx: number | null) => void;
  fitToken: number;
  /** Route indices matching the active filter; null when no filter is applied. */
  matches?: Set<number> | null;
}

interface View {
  lng: number;
  lat: number;
  zoom: number;
}

const DEFAULT_VIEW: View = { lng: 96.156, lat: 16.805, zoom: 12 };
const TILE = 256;
const MIN_Z = 2;
const MAX_Z = 18;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function project(lng: number, lat: number, zoom: number) {
  const s = TILE * 2 ** zoom;
  const x = ((lng + 180) / 360) * s;
  const clamped = clamp(lat, -85.05112878, 85.05112878);
  const r = (clamped * Math.PI) / 180;
  const y = (0.5 - Math.log((1 + Math.sin(r)) / (1 - Math.sin(r))) / (4 * Math.PI)) * s;
  return { x, y };
}

function unproject(x: number, y: number, zoom: number) {
  const s = TILE * 2 ** zoom;
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lng, lat };
}

function screenToLngLat(sx: number, sy: number, view: View, w: number, h: number) {
  const c = project(view.lng, view.lat, view.zoom);
  return unproject(c.x - w / 2 + sx, c.y - h / 2 + sy, view.zoom);
}

function lngLatToScreen(lng: number, lat: number, view: View, w: number, h: number) {
  const p = project(lng, lat, view.zoom);
  const c = project(view.lng, view.lat, view.zoom);
  return { x: p.x - c.x + w / 2, y: p.y - c.y + h / 2 };
}

function esriUrl(z: number, x: number, y: number) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}
function googleUrl(z: number, x: number, y: number) {
  return `https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
}
function eoxUrl(z: number, x: number, y: number) {
  return `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/${z}/${y}/${x}.jpg`;
}

function linesOf(
  geom: LineString | MultiLineString | { type: string; coordinates: Position[] | Position[][] }
): Position[][] {
  if (geom.type === 'LineString') return [geom.coordinates as Position[]];
  if (geom.type === 'MultiLineString') return geom.coordinates as Position[][];
  return [];
}

type ScreenPoint = { x: number; y: number };
type VisibleEdge = { x: number; y: number; dx: number; dy: number; length: number };

// Clip in vertex order so arrows also appear where a long edge crosses the viewport.
function clipEdge(a: ScreenPoint, b: ScreenPoint, width: number, height: number): VisibleEdge | null {
  if (width <= 20 || height <= 20) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - 10, width - 10 - a.x, a.y - 10, height - 10 - a.y];
  let enter = 0;
  let exit = 1;

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }

  const clippedDx = dx * (exit - enter);
  const clippedDy = dy * (exit - enter);
  const length = Math.hypot(clippedDx, clippedDy);
  if (length < 0.5) return null;
  return {
    x: a.x + dx * enter,
    y: a.y + dy * enter,
    dx: clippedDx,
    dy: clippedDy,
    length,
  };
}

function paintArrow(
  ctx: CanvasRenderingContext2D,
  edge: VisibleEdge,
  fraction: number,
  selected: boolean
) {
  ctx.save();
  ctx.translate(edge.x + edge.dx * fraction, edge.y + edge.dy * fraction);
  ctx.rotate(Math.atan2(edge.dy, edge.dx));
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -3.6);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 3.6);
  ctx.closePath();
  ctx.fillStyle = selected ? '#172435' : '#ffffff';
  ctx.strokeStyle = selected ? '#ffffff' : '#172435';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function paintDirectionArrows(
  ctx: CanvasRenderingContext2D,
  line: Position[],
  toScreen: (lng: number, lat: number) => ScreenPoint,
  width: number,
  height: number,
  selected: boolean,
  budget: number
): number {
  if (line.length < 2 || budget <= 0) return 0;
  const spacing = selected ? 70 : 100;
  const maxArrows = Math.min(budget, selected ? 40 : 12);
  let nextArrow = spacing / 2;
  let distance = 0;
  let drawn = 0;
  let longestEdge: VisibleEdge | null = null;
  let previous = toScreen(line[0][0], line[0][1]);

  for (let i = 1; i < line.length; i++) {
    const current = toScreen(line[i][0], line[i][1]);
    const edge = clipEdge(previous, current, width, height);
    previous = current;
    if (!edge) continue;
    if (!longestEdge || edge.length > longestEdge.length) longestEdge = edge;

    while (nextArrow <= distance + edge.length && drawn < maxArrows) {
      paintArrow(ctx, edge, (nextArrow - distance) / edge.length, selected);
      drawn++;
      nextArrow += spacing;
    }
    distance += edge.length;
  }

  // Short routes still get one arrow instead of silently losing their direction.
  if (drawn === 0 && longestEdge && distance >= 10) {
    paintArrow(ctx, longestEdge, 0.5, selected);
    return 1;
  }
  return drawn;
}

function fitBbox(
  bbox: [number, number, number, number],
  w: number,
  h: number,
  pad = 70,
  maxZoom = 16
): View | null {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (!Number.isFinite(minLng) || w < 20 || h < 20) return null;
  let zoom = MIN_Z;
  for (let z = maxZoom; z >= MIN_Z; z -= 0.25) {
    const nw = project(minLng, maxLat, z);
    const se = project(maxLng, minLat, z);
    if (se.x - nw.x <= w - pad * 2 && se.y - nw.y <= h - pad * 2) {
      zoom = z;
      break;
    }
  }
  return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2, zoom };
}

function unionBbox(routes: RouteFeature[]): [number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of routes) {
    if (r.empty) continue;
    minX = Math.min(minX, r.bbox[0]);
    minY = Math.min(minY, r.bbox[1]);
    maxX = Math.max(maxX, r.bbox[2]);
    maxY = Math.max(maxY, r.bbox[3]);
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

export default function MapView({ data, routes, selected, onSelect, fitToken, matches = null }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>(DEFAULT_VIEW);
  const [view, setView] = useState<View>(viewRef.current);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [failed, setFailed] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState('grab');
  const dragRef = useRef<{ x: number; y: number; lng: number; lat: number; moved: boolean } | null>(
    null
  );
  const pendingFit = useRef(false);
  const fittedSel = useRef<number | null>(null);

  const commit = (v: View) => {
    const next = { lng: v.lng, lat: clamp(v.lat, -85, 85), zoom: clamp(v.zoom, MIN_Z, MAX_Z) };
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    pendingFit.current = true;
  }, [fitToken]);

  useEffect(() => {
    if (!pendingFit.current || size.w < 40) return;
    const box = unionBbox(routes);
    if (!box) {
      pendingFit.current = false;
      fittedSel.current = null;
      commit(DEFAULT_VIEW);
      return;
    }
    const v = fitBbox(box, size.w, size.h, 70, 15);
    if (v) {
      commit(v);
      pendingFit.current = false;
    }
  }, [fitToken, routes, size.w, size.h]);

  // Zoom to the filtered routes whenever the match set changes.
  useEffect(() => {
    if (!matches || matches.size === 0 || size.w < 40) return;
    const box = unionBbox(routes.filter((r) => matches.has(r.idx)));
    if (!box) return;
    const v = fitBbox(box, size.w, size.h, 70, 16);
    if (v) commit(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  useEffect(() => {
    if (!selected) {
      fittedSel.current = null;
      return;
    }
    if (selected.empty || size.w < 40) return;
    if (fittedSel.current === selected.idx) return;
    fittedSel.current = selected.idx;
    const v = fitBbox(selected.bbox, size.w, size.h, 110, 16);
    if (v) commit(v);
  }, [selected, size.w, size.h]);

  const tiles = useMemo(() => {
    if (size.w < 1 || size.h < 1) return [];
    const z = Math.floor(view.zoom);
    const tilePx = TILE * 2 ** (view.zoom - z);
    const c = project(view.lng, view.lat, view.zoom);
    const originX = c.x - size.w / 2;
    const originY = c.y - size.h / 2;
    const n = 2 ** z;
    const x0 = Math.floor(originX / tilePx) - 1;
    const y0 = Math.floor(originY / tilePx) - 1;
    const x1 = Math.floor((originX + size.w) / tilePx) + 1;
    const y1 = Math.floor((originY + size.h) / tilePx) + 1;
    const out: { key: string; reactKey: string; src: string; left: number; top: number; size: number }[] =
      [];
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const x = ((tx % n) + n) % n;
        const key = `${z}/${ty}/${x}`;
        const stage = failed[key] || 0;
        if (stage >= 3) continue;
        const src =
          stage === 0 ? esriUrl(z, x, ty) : stage === 1 ? googleUrl(z, x, ty) : eoxUrl(z, x, ty);
        out.push({
          key,
          reactKey: `${z}/${ty}/${tx}/${stage}`,
          src,
          left: tx * tilePx - originX,
          top: ty * tilePx - originY,
          size: tilePx + 0.8,
        });
      }
    }
    return out;
  }, [view, size, failed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 1 || size.h < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(size.w * dpr));
    canvas.height = Math.max(1, Math.floor(size.h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const toScreen = (lng: number, lat: number) => lngLatToScreen(lng, lat, view, size.w, size.h);

    const strokeLines = (lines: Position[][], color: string, width: number, halo?: string) => {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const line of lines) {
        if (line.length < 2) continue;
        let started = false;
        for (const c of line) {
          const p = toScreen(c[0], c[1]);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
      }
      if (halo) {
        ctx.strokeStyle = halo;
        ctx.lineWidth = width + 3;
        ctx.stroke();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    if (data) {
      const nw = screenToLngLat(0, 0, view, size.w, size.h);
      const se = screenToLngLat(size.w, size.h, view, size.w, size.h);
      const pad = 0.02;
      const vb: [number, number, number, number] = [
        Math.min(nw.lng, se.lng) - pad,
        Math.min(nw.lat, se.lat) - pad,
        Math.max(nw.lng, se.lng) + pad,
        Math.max(nw.lat, se.lat) + pad,
      ];
      const matchedLines: Position[][] = [];
      const defaultLines: Position[][] = [];
      for (const f of data.features) {
        if (selected && f.properties?.idx === selected.idx) continue;
        const g = f.geometry;
        if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) continue;
        const lines = linesOf(g);
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const line of lines)
          for (const c of line) {
            if (c[0] < minX) minX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] > maxY) maxY = c[1];
          }
        if (maxX < vb[0] || minX > vb[2] || maxY < vb[1] || minY > vb[3]) continue;
        if (matches && matches.has(Number(f.properties?.idx))) {
          matchedLines.push(...lines);
        } else {
          defaultLines.push(...lines);
        }
      }

      // Remaining routes: default blue color
      if (defaultLines.length) {
        strokeLines(
          defaultLines,
          '#38bdf8',
          view.zoom < 8 ? 1.6 : 2.5,
          'rgba(2,6,23,0.72)'
        );
      }

      // Matched search routes: bright yellow color on top
      if (matchedLines.length) {
        strokeLines(
          matchedLines,
          '#facc15',
          view.zoom < 8 ? 2.5 : 3.5,
          'rgba(2,6,23,0.85)'
        );
      }

      // Keep dense datasets readable; direction arrows for active routes.
      const activeLines = matchedLines.length ? matchedLines : defaultLines;
      const arrowBudget = 1600;
      const stride = Math.max(1, Math.ceil(activeLines.length / Math.floor(arrowBudget / 3)));
      let arrowsDrawn = 0;
      for (let i = 0; i < activeLines.length && arrowsDrawn < arrowBudget; i += stride) {
        arrowsDrawn += paintDirectionArrows(
          ctx,
          activeLines[i],
          toScreen,
          size.w,
          size.h,
          false,
          arrowBudget - arrowsDrawn
        );
      }

      if (view.zoom >= 11) {
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const taken = new Set<string>();
        let drawn = 0;
        for (const f of data.features) {
          if (drawn > 40) break;
          if (matches && !matches.has(Number(f.properties?.idx))) continue;
          const g = f.geometry;
          if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) continue;
          const line = linesOf(g)[0];
          if (!line?.length) continue;
          const mid = line[Math.floor(line.length / 2)];
          const p = toScreen(mid[0], mid[1]);
          if (p.x < 8 || p.y < 8 || p.x > size.w - 8 || p.y > size.h - 8) continue;
          const cell = `${Math.floor(p.x / 90)},${Math.floor(p.y / 28)}`;
          if (taken.has(cell)) continue;
          taken.add(cell);
          const label = String(f.properties?.routeId ?? '');
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(2,6,23,0.85)';
          ctx.strokeText(label, p.x, p.y - 4);
          ctx.fillStyle = matches ? '#fde047' : '#ffffff';
          ctx.fillText(label, p.x, p.y - 4);
          drawn++;
        }
      }

    }

    if (selected && !selected.empty) {
      strokeLines(selected.segments, '#fbbf24', 4.5, 'rgba(0,0,0,0.8)');
      for (const segment of selected.segments) {
        paintDirectionArrows(ctx, segment, toScreen, size.w, size.h, true, 40);
      }
      const first = selected.segments[0];
      const last = selected.segments[selected.segments.length - 1];
      const drawDot = (lng: number, lat: number, color: string, text: string) => {
        const p = toScreen(lng, lat);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(text, p.x + 10, p.y);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, p.x + 10, p.y);
      };
      if (first?.length) drawDot(first[0][0], first[0][1], '#16a34a', 'Start');
      if (last?.length) {
        const e = last[last.length - 1];
        drawDot(e[0], e[1], '#dc2626', 'End');
      }
    }
  }, [view, size, data, selected, matches]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 0.6 : -0.6;
      const cur = viewRef.current;
      const nextZoom = clamp(cur.zoom + delta, MIN_Z, MAX_Z);
      const before = screenToLngLat(sx, sy, cur, size.w, size.h);
      const draft = { ...cur, zoom: nextZoom };
      const after = screenToLngLat(sx, sy, draft, size.w, size.h);
      commit({
        zoom: nextZoom,
        lng: cur.lng + (before.lng - after.lng),
        lat: cur.lat + (before.lat - after.lat),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size.w, size.h]);

  const hitTest = (sx: number, sy: number) => {
    if (!data || size.w < 1 || size.h < 1) return null;
    let best: number | null = null;
    let bestD = 12;
    for (const f of data.features) {
      const g = f.geometry;
      if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) continue;
      for (const line of linesOf(g)) {
        for (let i = 1; i < line.length; i++) {
          const a = lngLatToScreen(line[i - 1][0], line[i - 1][1], viewRef.current, size.w, size.h);
          const b = lngLatToScreen(line[i][0], line[i][1], viewRef.current, size.w, size.h);
          if (
            Math.min(a.x, b.x) - 12 > sx ||
            Math.max(a.x, b.x) + 12 < sx ||
            Math.min(a.y, b.y) - 12 > sy ||
            Math.max(a.y, b.y) + 12 < sy
          )
            continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const t = clamp(((sx - a.x) * dx + (sy - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          const d = Math.hypot(a.x + t * dx - sx, a.y + t * dy - sy);
          if (d < bestD) {
            bestD = d;
            best = Number(f.properties?.idx);
          }
        }
        if (bestD < 4) return best;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      lng: viewRef.current.lng,
      lat: viewRef.current.lat,
      moved: false,
    };
    setCursor('grabbing');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) {
      const rect2 = wrapRef.current?.getBoundingClientRect();
      if (rect2) {
        const hit = hitTest(e.clientX - rect2.left, e.clientY - rect2.top);
        setCursor(hit !== null ? 'pointer' : 'grab');
      }
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    const c = project(d.lng, d.lat, viewRef.current.zoom);
    const n = unproject(c.x - dx, c.y - dy, viewRef.current.zoom);
    commit({ ...viewRef.current, lng: n.lng, lat: n.lat });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setCursor('grab');
    if (d && !d.moved) {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      // A route selects/deselects; empty map space clears the selection.
      onSelect(hit !== null && !Number.isNaN(hit) ? hit : null);
    }
  };

  // Read live dimensions first: the stored size can be stale (or zero) after a
  // view/panel switch, which used to make these controls silently do nothing.
  const measureNow = () => {
    const el = wrapRef.current;
    const w = el ? el.clientWidth : size.w;
    const h = el ? el.clientHeight : size.h;
    if (w > 0 && h > 0 && (w !== size.w || h !== size.h)) setSize({ w, h });
    return { w, h };
  };

  const zoomBy = (delta: number) => {
    const { w, h } = measureNow();
    if (w < 20 || h < 20) return;
    const cur = viewRef.current;
    const nextZoom = clamp(cur.zoom + delta, MIN_Z, MAX_Z);
    if (nextZoom === cur.zoom) return;
    commit({ ...cur, zoom: nextZoom });
  };

  return (
    <div
      ref={wrapRef}
      className="map-sat relative h-full w-full overflow-hidden bg-white"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        e.preventDefault();
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect) return;
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const cur = viewRef.current;
        const nextZoom = clamp(cur.zoom + 1, MIN_Z, MAX_Z);
        const before = screenToLngLat(sx, sy, cur, size.w, size.h);
        const draft = { ...cur, zoom: nextZoom };
        const after = screenToLngLat(sx, sy, draft, size.w, size.h);
        commit({
          zoom: nextZoom,
          lng: cur.lng + before.lng - after.lng,
          lat: cur.lat + before.lat - after.lat,
        });
      }}
    >
      {tiles.map((t) => (
        <img
          key={t.reactKey}
          src={t.src}
          alt=""
          draggable={false}
          onError={() => setFailed((f) => ({ ...f, [t.key]: Math.min(3, (f[t.key] || 0) + 1) }))}
          style={{
            position: 'absolute',
            left: t.left,
            top: t.top,
            width: t.size,
            height: t.size,
            maxWidth: 'none',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      ))}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* MapLibre-style zoom controls — bottom-right, matching Point File Creator. */}
      <div
        className="maplibregl-ctrl-group pointer-events-auto absolute bottom-4 right-4 z-10"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="maplibregl-ctrl-zoom-in"
          title="Zoom in"
          aria-label="Zoom in"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(1);
          }}
        >
          <span className="maplibregl-ctrl-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="maplibregl-ctrl-zoom-out"
          title="Zoom out"
          aria-label="Zoom out"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(-1);
          }}
        >
          <span className="maplibregl-ctrl-icon" aria-hidden="true" />
        </button>
      </div>

    </div>
  );
}

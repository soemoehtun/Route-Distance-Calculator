import proj4 from 'proj4';
import type { FeatureCollection } from 'geojson';
import type { GeometryType, RouteFeature } from '../types';
import { segmentLength } from './distance';

export interface RawFeature {
  geometryType: GeometryType;
  segments: number[][][];
  attributes: Record<string, string | number>;
}

export function makeTransformer(prjOrEpsg: string | null): ((c: number[]) => number[]) | null {
  if (!prjOrEpsg) return null;
  const src = prjOrEpsg.trim();
  if (!src) return null;
  try {
    const lower = src.toLowerCase();
    if (
      lower.includes('wgs_1984') ||
      lower.includes('wgs 84') ||
      lower.includes('epsg:4326') ||
      lower.includes('longlat')
    ) {
      if (lower.includes('utm') || lower.includes('projcs')) {
        // projected even if datum is WGS84 -> still needs transform
      } else {
        return null;
      }
    }
    const fwd = proj4(src, 'EPSG:4326');
    return (c: number[]) => {
      const r = fwd.forward([c[0], c[1]]);
      return [r[0], r[1]];
    };
  } catch {
    return null;
  }
}

export function crsNameFromWkt(wkt: string | null): { name: string; detected: boolean } {
  if (!wkt) return { name: 'WGS84 / EPSG:4326 (assumed)', detected: false };
  const m = wkt.match(/^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*"([^"]+)"/i);
  const epsg = [...wkt.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/gi)].pop();
  const name = m ? m[1] : 'Detected from source';
  return { name: epsg ? `${name} / EPSG:${epsg[1]}` : name, detected: true };
}

const ID_FIELDS = ['route_id', 'routeid', 'id', 'rte_id', 'link_id', 'fid', 'code'];
const NAME_FIELDS = ['route_name', 'routename', 'name', 'rte_name', 'label', 'title', 'desc'];

export function guessField(fields: string[], kind: 'id' | 'name'): string {
  const pool = kind === 'id' ? ID_FIELDS : NAME_FIELDS;
  for (const p of pool) {
    const hit = fields.find((f) => f.toLowerCase().replace(/[^a-z0-9_]/g, '') === p);
    if (hit) return hit;
  }
  for (const p of pool) {
    const hit = fields.find((f) => f.toLowerCase().includes(p));
    if (hit) return hit;
  }
  return '';
}

export function isRouteGeometry(t: GeometryType) {
  return t === 'LineString' || t === 'MultiLineString';
}

export function buildRoutes(
  raws: RawFeature[],
  idField: string,
  nameField: string,
  transform: ((c: number[]) => number[]) | null,
  onProgress?: (done: number, total: number, current: string) => void
): RouteFeature[] {
  const out: RouteFeature[] = [];
  const total = raws.length;
  const pad = String(total).length < 3 ? 3 : String(total).length;
  for (let i = 0; i < total; i++) {
    const raw = raws[i];
    let segs = raw.segments;
    if (transform) segs = segs.map((s) => s.map((c) => transform(c)));
    segs = segs.map((s) => s.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])));

    const segmentLengths = segs.map((s) => segmentLength(s));
    const lengthM = segmentLengths.reduce((a, b) => a + b, 0);
    const vertices = segs.reduce((a, s) => a + s.length, 0);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const s of segs)
      for (const c of s) {
        if (c[0] < minX) minX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] > maxY) maxY = c[1];
      }

    const autoId = 'ROUTE' + String(i + 1).padStart(pad, '0');
    const idVal = idField ? raw.attributes[idField] : undefined;
    const nameVal = nameField ? raw.attributes[nameField] : undefined;

    const empty = vertices === 0;
    const invalid = !empty && (vertices < 2 || lengthM === 0);

    out.push({
      idx: i,
      routeId: idVal !== undefined && String(idVal).trim() !== '' ? String(idVal) : autoId,
      routeName:
        nameVal !== undefined && String(nameVal).trim() !== '' ? String(nameVal) : autoId,
      geometryType: raw.geometryType,
      segments: segs,
      segmentLengths,
      vertices,
      lengthM,
      attributes: raw.attributes,
      bbox: empty ? [0, 0, 0, 0] : [minX, minY, maxX, maxY],
      invalid,
      empty,
    });

    if (onProgress && (i % 250 === 0 || i === total - 1))
      onProgress(i + 1, total, out[out.length - 1].routeId);
  }
  return out;
}

/** Douglas-Peucker simplification used only for map rendering. */
export function simplify(points: number[][], tolerance: number): number[][] {
  if (points.length < 3) return points;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const denom = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let t = denom ? ((px - x1) * dx + (py - y1) * dy) / denom : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x1 + t * dx - px;
      const ey = y1 + t * dy - py;
      const sq = ex * ex + ey * ey;
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }
    if (index > -1 && maxSq > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const result: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

export function routesToGeoJSON(routes: RouteFeature[], tolerance = 0): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((r) => !r.empty)
      .map((r) => {
        const segs = tolerance
          ? r.segments.map((s) => (s.length > 4 ? simplify(s, tolerance) : s))
          : r.segments;
        return {
          type: 'Feature' as const,
          id: r.idx,
          properties: {
            idx: r.idx,
            routeId: r.routeId,
            routeName: r.routeName,
            lengthM: r.lengthM,
          },
          geometry:
            segs.length === 1
              ? { type: 'LineString' as const, coordinates: segs[0] }
              : { type: 'MultiLineString' as const, coordinates: segs },
        };
      }),
  };
}

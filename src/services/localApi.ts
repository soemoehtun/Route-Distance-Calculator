import type { GeometryType, ImportResult, RouteFeature } from '../types';
import { parseKmlText, parseKmz } from '../engine/kml';
import { parseShapefile } from '../engine/shapefile';
import { parseMapInfo } from '../engine/mapinfo';
import {
  buildRoutes,
  crsNameFromWkt,
  guessField,
  isRouteGeometry,
  makeTransformer,
  type RawFeature,
} from '../engine/geometry';

export const ENGINE_URL = 'http://127.0.0.1:8765';

/** Probe the bundled local Go engine. The browser preview falls back to the
 *  identical TypeScript implementation of the same algorithms. */
export async function pingEngine(signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`${ENGINE_URL}/api/health`, { signal });
    return r.ok;
  } catch {
    return false;
  }
}

export interface FileGroup {
  kind: 'kml' | 'kmz' | 'shapefile' | 'mapinfo';
  name: string;
  parts: Record<string, File>;
  missing: string[];
}

const SHP_REQUIRED = ['shp', 'shx', 'dbf'];
const TAB_REQUIRED = ['tab'];

export function groupFiles(files: File[]): { group: FileGroup | null; error: string | null } {
  if (!files.length) return { group: null, error: null };
  const parts: Record<string, File> = {};
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    parts[ext] = f;
  }
  const base = files[0].name.replace(/\.[^.]+$/, '');

  if (parts.kmz) return { group: { kind: 'kmz', name: parts.kmz.name, parts, missing: [] }, error: null };
  if (parts.kml) return { group: { kind: 'kml', name: parts.kml.name, parts, missing: [] }, error: null };
  if (parts.shp) {
    const missing = SHP_REQUIRED.filter((e) => !parts[e]);
    return { group: { kind: 'shapefile', name: base, parts, missing }, error: null };
  }
  if (parts.tab || parts.mif) {
    const missing = parts.mif ? [] : TAB_REQUIRED.filter((e) => !parts[e]);
    return { group: { kind: 'mapinfo', name: base, parts, missing }, error: null };
  }
  return {
    group: null,
    error: 'Unsupported file format. Supported inputs: KML, KMZ, SHP (+SHX/DBF/PRJ), TAB / MIF.',
  };
}

interface CacheEntry {
  raws: RawFeature[];
  fields: string[];
  crs: string;
  crsDetected: boolean;
  crsDef: string | null;
}
const cache = new Map<string, CacheEntry>();

export function discardJob(jobId: string): void {
  cache.delete(jobId);
}

export async function importRouteFile(group: FileGroup): Promise<ImportResult> {
  if (group.missing.length)
    throw new Error(
      `Invalid ${group.kind === 'shapefile' ? 'Shapefile' : 'MapInfo dataset'}: missing ${group.missing
        .map((m) => '.' + m)
        .join(', ')}`
    );

  let raws: RawFeature[] = [];
  let fields: string[] = [];
  let crs = 'WGS84 / EPSG:4326';
  let crsDetected = true;
  let crsDef: string | null = null;
  const warnings: string[] = [];

  if (group.kind === 'kml') {
    const r = parseKmlText(await group.parts.kml.text());
    raws = r.features;
    fields = r.fields;
    crs = 'WGS84 / EPSG:4326 (KML default)';
  } else if (group.kind === 'kmz') {
    const r = await parseKmz(group.parts.kmz);
    raws = r.features;
    fields = r.fields;
    crs = 'WGS84 / EPSG:4326 (KML default)';
  } else if (group.kind === 'shapefile') {
    const r = await parseShapefile(group.parts);
    raws = r.features;
    fields = r.fields;
    const info = crsNameFromWkt(r.prj);
    crs = info.name;
    crsDetected = info.detected;
    crsDef = r.prj;
    if (!r.prj) warnings.push('No .prj file supplied — coordinates are assumed to be WGS84.');
  } else {
    const r = await parseMapInfo(group.parts);
    raws = r.features;
    fields = r.fields;
    crs = r.crsLabel || 'Detected from source';
    crsDetected = !!r.crsLabel;
    crsDef = r.crsDef;
  }

  if (!raws.length) throw new Error('No route geometry found in this file.');

  const geometryTypes: Record<string, number> = {};
  for (const r of raws) geometryTypes[r.geometryType] = (geometryTypes[r.geometryType] || 0) + 1;
  const nonRouteCount = raws.filter((r) => !isRouteGeometry(r.geometryType)).length;

  const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  cache.set(jobId, { raws, fields, crs, crsDetected, crsDef });

  return {
    jobId,
    fileName: group.name,
    fileKinds: Object.keys(group.parts),
    crs,
    crsDetected,
    fields,
    routes: [],
    geometryTypes: geometryTypes as Record<GeometryType, number>,
    warnings,
    nonRouteCount,
  };
}

export interface CalcOptions {
  idField: string;
  nameField: string;
  crsOverride?: string | null;
  includeNonRoute?: boolean;
}

export async function calculateDistances(
  jobId: string,
  opts: CalcOptions,
  onProgress: (done: number, total: number, current: string) => void,
  signal?: AbortSignal
): Promise<{ routes: RouteFeature[]; warnings: string[] }> {
  const entry = cache.get(jobId);
  if (!entry) throw new Error('This import session has expired. Please re-import the file.');

  const transform = makeTransformer(opts.crsOverride ?? entry.crsDef);
  const source = opts.includeNonRoute
    ? entry.raws
    : entry.raws.filter((r) => isRouteGeometry(r.geometryType));
  if (!source.length) throw new Error('No route (line) geometry found in this file.');

  // Chunked processing keeps the UI responsive, mirroring the Go worker pool.
  const routes: RouteFeature[] = [];
  const CHUNK = 500;
  for (let start = 0; start < source.length; start += CHUNK) {
    if (signal?.aborted) throw new DOMException('Calculation cancelled.', 'AbortError');
    const slice = source.slice(start, start + CHUNK);
    const built = buildRoutes(slice, opts.idField, opts.nameField, transform);
    built.forEach((b, i) => {
      b.idx = start + i;
      if (/^ROUTE\d+$/.test(b.routeId))
        b.routeId = 'ROUTE' + String(start + i + 1).padStart(3, '0');
      if (/^ROUTE\d+$/.test(b.routeName)) b.routeName = b.routeId;
      routes.push(b);
    });
    onProgress(
      Math.min(start + CHUNK, source.length),
      source.length,
      routes[routes.length - 1]?.routeId || ''
    );
    await new Promise((r) => setTimeout(r, 0));
  }

  if (signal?.aborted) throw new DOMException('Calculation cancelled.', 'AbortError');

  const warnings: string[] = [];
  const invalid = routes.filter((r) => r.invalid).length;
  const empty = routes.filter((r) => r.empty).length;
  if (invalid) warnings.push(`${invalid} route${invalid > 1 ? 's' : ''} contain invalid geometry`);
  if (empty) warnings.push(`${empty} route${empty > 1 ? 's' : ''} contain empty geometry`);

  return { routes, warnings };
}

export function defaultFields(fields: string[]) {
  return { idField: guessField(fields, 'id'), nameField: guessField(fields, 'name') };
}

/* ---------------- sample dataset (for demo / testing) ---------------- */
export function sampleKml(): File {
  const rnd = (seed: number) => {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  };
  const r = rnd(42);
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Yangon_Route_Sample</name>',
  ];
  for (let i = 0; i < 120; i++) {
    let lon = 96.05 + r() * 0.35;
    let lat = 16.72 + r() * 0.3;
    // 120-320 vertices with a bearing-walk so lines look like real fiber routes.
    const n = 120 + Math.floor(r() * 200);
    let bearing = r() * Math.PI * 2;
    const coords: string[] = [];
    for (let k = 0; k < n; k++) {
      bearing += (r() - 0.5) * 0.9;
      const step = 0.0004 + r() * 0.0005;
      lon += Math.cos(bearing) * step;
      lat += Math.sin(bearing) * step;
      coords.push(`${lon.toFixed(6)},${lat.toFixed(6)},0`);
    }
    parts.push(
      `<Placemark><LineString><coordinates>${coords.join(' ')}</coordinates></LineString></Placemark>`
    );
  }
  parts.push('</Document></kml>');
  return new File([parts.join('')], 'Yangon_Route_Sample.kml', {
    type: 'application/vnd.google-earth.kml+xml',
  });
}

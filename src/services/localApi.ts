import type { FileKind, GeometryType, ImportResult, ImportSource, RouteFeature } from '../types';
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
  kind: FileKind;
  name: string;
  parts: Record<string, File>;
  missing: string[];
}

/** Sidecar parts of one shapefile, matched to their .shp by file-name stem. */
const SHP_PARTS = ['shp', 'shx', 'dbf', 'prj', 'cpg'];
const SHP_REQUIRED = ['shp', 'shx', 'dbf'];
/** Native MapInfo tabular set. */
const TAB_PARTS = ['tab', 'dat', 'map', 'id'];
const TAB_REQUIRED = ['tab'];
/** MapInfo interchange set. */
const MIF_PARTS = ['mif', 'mid'];

const SUPPORTED_EXTENSIONS = new Set([
  'kml',
  'kmz',
  ...SHP_PARTS,
  ...TAB_PARTS,
  ...MIF_PARTS,
]);

const UNSUPPORTED_MESSAGE =
  'Supported inputs: KML, KMZ, SHP (+SHX/DBF/PRJ/CPG), TAB (+DAT/MAP/ID), MIF (+MID).';

function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

/** Split a flat file selection into one group per dataset. Every KML/KMZ is its
 *  own dataset; shapefile and MapInfo sidecars are matched to their dataset by
 *  file-name stem, so several datasets can be dropped together. */
export function groupFiles(files: File[]): { groups: FileGroup[]; errors: string[] } {
  const errors: string[] = [];
  const buckets = new Map<string, { group: FileGroup; seen: Set<string> }>();
  const order: string[] = [];

  const openBucket = (key: string, kind: FileKind, name: string) => {
    let entry = buckets.get(key);
    if (!entry) {
      entry = { group: { kind, name, parts: {}, missing: [] }, seen: new Set() };
      buckets.set(key, entry);
      order.push(key);
    }
    return entry;
  };

  for (const file of files) {
    const ext = extOf(file.name);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      errors.push(`${file.name} was skipped — unsupported format. ${UNSUPPORTED_MESSAGE}`);
      continue;
    }

    if (ext === 'kml' || ext === 'kmz') {
      const entry = openBucket(`doc:${stemOf(file.name)}`, ext, file.name);
      entry.group.parts[ext] = file;
      entry.seen.add(ext);
      continue;
    }

    const kind: FileKind = SHP_PARTS.includes(ext) ? 'shapefile' : 'mapinfo';
    const stem = stemOf(file.name);
    const entry = openBucket(`${kind}:${stem}`, kind, stem);
    entry.group.parts[ext] = file;
    entry.seen.add(ext);
  }

  const groups: FileGroup[] = [];
  for (const key of order) {
    const { group, seen } = buckets.get(key)!;
    const required =
      group.kind === 'shapefile'
        ? SHP_REQUIRED
        : group.kind === 'mapinfo'
          ? seen.has('mif')
            ? ['mif']
            : TAB_REQUIRED
          : [];
    group.missing = required.filter((ext) => !seen.has(ext));
    if (group.missing.length) {
      errors.push(
        `“${group.name}” was skipped — incomplete ${group.kind === 'shapefile' ? 'shapefile' : 'MapInfo'} dataset, missing ${group.missing
          .map((m) => '.' + m)
          .join(', ')}.`
      );
      continue;
    }
    groups.push(group);
  }

  return { groups, errors };
}

interface Dataset {
  name: string;
  kind: FileKind;
  fileNames: string[];
  raws: RawFeature[];
  crs: string;
  crsDetected: boolean;
  crsDef: string | null;
}

interface CacheEntry {
  datasets: Dataset[];
  fields: string[];
}
const cache = new Map<string, CacheEntry>();

export function discardJob(jobId: string): void {
  cache.delete(jobId);
}

async function readDataset(group: FileGroup): Promise<Dataset & { fields: string[]; warnings: string[] }> {
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

  return {
    name: group.name,
    kind: group.kind,
    fileNames: Object.values(group.parts).map((f) => f.name),
    raws,
    fields,
    crs,
    crsDetected,
    crsDef,
    warnings,
  };
}

/** Read and merge any number of datasets into a single import session. Each
 *  dataset keeps its own coordinate system, reprojected independently later. */
export async function importRouteFiles(
  groups: FileGroup[],
  onProgress?: (done: number, total: number, current: string) => void
): Promise<ImportResult> {
  if (!groups.length) throw new Error(`No importable dataset in this selection. ${UNSUPPORTED_MESSAGE}`);

  const warnings: string[] = [];
  const datasets: Dataset[] = [];
  const fieldSet = new Set<string>();

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    onProgress?.(i, groups.length, group.name);
    let dataset: Dataset & { fields: string[]; warnings: string[] };
    try {
      dataset = await readDataset(group);
    } catch (e) {
      warnings.push(`“${group.name}” was skipped — ${(e as Error).message}`);
      continue;
    }
    if (!dataset.raws.length) {
      warnings.push(`“${group.name}” was skipped — no route geometry found in this dataset.`);
      continue;
    }
    dataset.fields.forEach((f) => fieldSet.add(f));
    dataset.warnings.forEach((w) => warnings.push(`“${dataset.name}”: ${w}`));
    datasets.push(dataset);
    // Yield between datasets so the progress bar repaints for large selections.
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress?.(groups.length, groups.length, '');

  if (!datasets.length) {
    // Surface why each dataset was dropped rather than a bare "nothing found".
    const detail = warnings.length ? ' ' + warnings.join(' ') : '';
    throw new Error(`No route geometry found in the selected file(s).${detail}`);
  }

  const raws: RawFeature[] = [];
  const geometryTypes: Record<string, number> = {};
  const sources: ImportSource[] = [];
  let nonRouteCount = 0;

  for (let i = 0; i < datasets.length; i++) {
    const dataset = datasets[i];
    for (const raw of dataset.raws) {
      raw.source = i;
      raws.push(raw);
      geometryTypes[raw.geometryType] = (geometryTypes[raw.geometryType] || 0) + 1;
    }
    const nonRoute = dataset.raws.filter((r) => !isRouteGeometry(r.geometryType)).length;
    nonRouteCount += nonRoute;
    sources.push({
      name: dataset.name,
      kind: dataset.kind,
      fileNames: dataset.fileNames,
      featureCount: dataset.raws.length,
      nonRouteCount: nonRoute,
      crs: dataset.crs,
      crsDetected: dataset.crsDetected,
    });
  }
  const crsLabels = Array.from(new Set(datasets.map((d) => d.crs)));
  const crs =
    crsLabels.length === 1
      ? crsLabels[0]
      : `${crsLabels.length} coordinate systems across ${datasets.length} datasets`;

  const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  cache.set(jobId, { datasets, fields: Array.from(fieldSet) });

  return {
    jobId,
    fileName: datasets.length === 1 ? datasets[0].name : `${datasets.length} datasets`,
    fileKinds: datasets.map((d) => d.kind),
    sources,
    crs,
    crsDetected: datasets.every((d) => d.crsDetected),
    fields: Array.from(fieldSet),
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
  if (!entry) throw new Error('This import session has expired. Please re-import the file(s).');

  // Every dataset carries its own coordinate system, so build one transform each.
  const override = opts.crsOverride?.trim() ? opts.crsOverride : null;
  const transforms = entry.datasets.map((d) => makeTransformer(override || d.crsDef));
  const labels = entry.datasets.map((d) => d.name);

  const source = entry.datasets.flatMap((d) =>
    opts.includeNonRoute ? d.raws : d.raws.filter((r) => isRouteGeometry(r.geometryType))
  );
  if (!source.length) throw new Error('No route (line) geometry found in the selected file(s).');

  // Chunked processing keeps the UI responsive, mirroring the Go worker pool.
  const routes: RouteFeature[] = [];
  const CHUNK = 500;
  const pad = String(source.length).length < 3 ? 3 : String(source.length).length;
  for (let start = 0; start < source.length; start += CHUNK) {
    if (signal?.aborted) throw new DOMException('Calculation cancelled.', 'AbortError');
    const slice = source.slice(start, start + CHUNK);
    const built = buildRoutes(slice, opts.idField, opts.nameField, transforms);
    built.forEach((b, i) => {
      const at = start + i;
      b.idx = at;
      b.source = labels[slice[i].source ?? 0] || '';
      // Renumber auto-ids globally so merged datasets never collide.
      if (/^ROUTE\d+$/.test(b.routeId)) b.routeId = 'ROUTE' + String(at + 1).padStart(pad, '0');
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

  // Merged datasets frequently repeat route ids; flag them so the export is auditable.
  const seenIds = new Set<string>();
  let duplicateIds = 0;
  for (const route of routes) {
    if (seenIds.has(route.routeId)) duplicateIds++;
    else seenIds.add(route.routeId);
  }
  if (duplicateIds)
    warnings.push(
      `${duplicateIds} route ID${duplicateIds > 1 ? 's are' : ' is'} duplicated across the selected files`
    );

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

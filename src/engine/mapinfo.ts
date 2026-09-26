import type { GeometryType } from '../types';
import type { RawFeature } from './geometry';
import { parseDbf } from './shapefile';

/** Convert a MapInfo CoordSys clause into a proj4 definition (common cases). */
export function coordSysToProj4(coordSys: string): { def: string | null; label: string } {
  const cs = coordSys.replace(/^\s*CoordSys\s+/i, '').trim();
  const m = cs.match(/Earth\s+Projection\s+([\d.]+)\s*,\s*([-\d.]+)((?:\s*,\s*[-\d.]+)*)/i);
  if (!m) {
    if (/nonearth/i.test(cs)) return { def: null, label: 'NonEarth (local) coordinate system' };
    return { def: null, label: 'Unknown MapInfo coordinate system' };
  }
  const proj = parseFloat(m[1]);
  const datum = parseFloat(m[2]);
  const rest = (m[3] || '')
    .split(',')
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));
  const datumStr = datum === 104 || datum === 0 ? '+datum=WGS84' : '+datum=WGS84';

  if (proj === 1) return { def: null, label: 'Longitude / Latitude (WGS84 / EPSG:4326)' };
  if (proj === 8 && rest.length >= 5) {
    // Transverse Mercator: units, origin lon, origin lat, scale, FE, FN
    const [, lon0, lat0, k, fe, fn] = rest;
    return {
      def: `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=${k} +x_0=${fe} +y_0=${fn} ${datumStr} +units=m +no_defs`,
      label: `Transverse Mercator (lon0 ${lon0})`,
    };
  }
  if (proj === 10 && rest.length >= 1) {
    return {
      def: `+proj=merc +lon_0=${rest[0]} ${datumStr} +units=m +no_defs`,
      label: 'Mercator',
    };
  }
  return { def: null, label: `MapInfo projection ${proj} (unsupported — select CRS manually)` };
}

function parseMifObjects(text: string, columns: string[], mid: string[][]) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !/^\s*data\s*$/i.test(lines[i])) i++;
  i++;
  const features: RawFeature[] = [];
  let rowIndex = 0;

  const readPts = (count: number): number[][] => {
    const pts: number[][] = [];
    while (pts.length < count && i < lines.length) {
      const parts = lines[i].trim().split(/[\s,]+/).map(parseFloat);
      i++;
      for (let k = 0; k + 1 < parts.length; k += 2) {
        if (Number.isFinite(parts[k]) && Number.isFinite(parts[k + 1]))
          pts.push([parts[k], parts[k + 1]]);
      }
    }
    return pts;
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    const upper = line.toUpperCase();
    let segments: number[][][] | null = null;
    let type: GeometryType = 'LineString';

    if (upper.startsWith('PLINE')) {
      i++;
      const multi = /MULTIPLE/i.test(line);
      if (multi) {
        const nSec = parseInt(line.replace(/[^0-9]/g, ''), 10) || 1;
        segments = [];
        for (let s = 0; s < nSec; s++) {
          const n = parseInt((lines[i] || '').trim(), 10);
          i++;
          segments.push(readPts(n));
        }
        type = 'MultiLineString';
      } else {
        const n = parseInt(line.split(/\s+/)[1], 10);
        if (Number.isFinite(n)) {
          segments = [readPts(n)];
        } else {
          const n2 = parseInt((lines[i] || '').trim(), 10);
          i++;
          segments = [readPts(n2)];
        }
        type = 'LineString';
      }
    } else if (upper.startsWith('LINE ')) {
      const p = line.split(/\s+/).slice(1).map(parseFloat);
      segments = [
        [
          [p[0], p[1]],
          [p[2], p[3]],
        ],
      ];
      type = 'LineString';
      i++;
    } else if (upper.startsWith('REGION')) {
      const nSec = parseInt(line.split(/\s+/)[1], 10) || 1;
      i++;
      segments = [];
      for (let s = 0; s < nSec; s++) {
        const n = parseInt((lines[i] || '').trim(), 10);
        i++;
        segments.push(readPts(n));
      }
      type = nSec > 1 ? 'MultiPolygon' : 'Polygon';
    } else if (upper.startsWith('POINT')) {
      const p = line.split(/\s+/).slice(1).map(parseFloat);
      segments = [[[p[0], p[1]]]];
      type = 'Point';
      i++;
    } else {
      i++;
      continue;
    }

    const attrs: Record<string, string | number> = {};
    const row = mid[rowIndex] || [];
    columns.forEach((c, ci) => (attrs[c] = row[ci] ?? ''));
    rowIndex++;
    if (segments) features.push({ geometryType: type, segments, attributes: attrs });
  }
  return features;
}

function splitMidLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === delim && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function parseMapInfo(files: Record<string, File>): Promise<{
  features: RawFeature[];
  fields: string[];
  crsDef: string | null;
  crsLabel: string | null;
}> {
  const header = files.mif ? await files.mif.text() : files.tab ? await files.tab.text() : '';
  const coordLine = header.split(/\r?\n/).find((l) => /^\s*CoordSys/i.test(l)) || '';
  const crs = coordLine ? coordSysToProj4(coordLine) : { def: null, label: null as string | null };

  // Columns
  const lines = header.split(/\r?\n/);
  const colIdx = lines.findIndex((l) => /^\s*columns\s+\d+/i.test(l));
  const columns: string[] = [];
  if (colIdx >= 0) {
    const n = parseInt(lines[colIdx].trim().split(/\s+/)[1], 10);
    for (let k = 1; k <= n && colIdx + k < lines.length; k++) {
      const name = lines[colIdx + k].trim().split(/\s+/)[0];
      if (name) columns.push(name);
    }
  }

  if (files.mif) {
    let mid: string[][] = [];
    if (files.mid) {
      const delim = (header.match(/Delimiter\s+"(.)"/i) || [, '\t'])[1] as string;
      mid = (await files.mid.text())
        .split(/\r?\n/)
        .filter((l) => l.length)
        .map((l) => splitMidLine(l, delim).map((s) => s.replace(/^"|"$/g, '')));
    }
    const features = parseMifObjects(await files.mif.text(), columns, mid);
    return { features, fields: columns, crsDef: crs.def, crsLabel: crs.label };
  }

  // Native TAB dataset: attributes live in the .dat (dBase) file, geometry in the binary .map.
  let fields = columns;
  if (files.dat) {
    try {
      fields = parseDbf(await files.dat.arrayBuffer()).fields;
    } catch {
      /* ignore */
    }
  }
  throw new Error(
    `Native MapInfo binary geometry (.map) requires the bundled Go engine. ` +
      `In the browser preview, please supply the MIF/MID export of this dataset ` +
      `(${fields.length ? 'fields detected: ' + fields.join(', ') : 'no fields detected'}).`
  );
}

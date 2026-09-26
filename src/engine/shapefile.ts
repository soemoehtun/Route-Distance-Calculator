import type { GeometryType } from '../types';
import type { RawFeature } from './geometry';

export function parseDbf(buf: ArrayBuffer): {
  records: Record<string, string | number>[];
  fields: string[];
} {
  const dv = new DataView(buf);
  const numRecords = dv.getUint32(4, true);
  const headerLen = dv.getUint16(8, true);
  const recordLen = dv.getUint16(10, true);

  const fields: { name: string; type: string; length: number }[] = [];
  let pos = 32;
  let dec: TextDecoder;
  try {
    dec = new TextDecoder('windows-1252');
  } catch {
    dec = new TextDecoder('utf-8');
  }
  while (pos < headerLen - 1) {
    const first = dv.getUint8(pos);
    if (first === 0x0d) break;
    const bytes = new Uint8Array(buf, pos, 11);
    let name = '';
    for (const b of bytes) {
      if (b === 0) break;
      name += String.fromCharCode(b);
    }
    const type = String.fromCharCode(dv.getUint8(pos + 11));
    const length = dv.getUint8(pos + 16);
    fields.push({ name: name.trim(), type, length });
    pos += 32;
  }

  const records: Record<string, string | number>[] = [];
  let offset = headerLen;
  for (let r = 0; r < numRecords; r++) {
    if (offset + recordLen > buf.byteLength) break;
    const deleted = dv.getUint8(offset) === 0x2a;
    let p = offset + 1;
    const rec: Record<string, string | number> = {};
    for (const f of fields) {
      const raw = dec.decode(new Uint8Array(buf, p, f.length)).trim();
      if (f.type === 'N' || f.type === 'F') {
        const n = parseFloat(raw);
        rec[f.name] = Number.isFinite(n) ? n : '';
      } else if (f.type === 'L') {
        rec[f.name] = /^[YyTt]$/.test(raw) ? 'true' : 'false';
      } else {
        rec[f.name] = raw;
      }
      p += f.length;
    }
    offset += recordLen;
    if (!deleted) records.push(rec);
  }
  return { records, fields: fields.map((f) => f.name) };
}

export function parseShp(buf: ArrayBuffer): { geoms: { type: GeometryType; segments: number[][][] }[] } {
  const dv = new DataView(buf);
  const fileCode = dv.getInt32(0, false);
  if (fileCode !== 9994) throw new Error('Invalid Shapefile: the .shp header is not recognised.');
  const geoms: { type: GeometryType; segments: number[][][] }[] = [];
  let pos = 100;
  while (pos + 8 <= buf.byteLength) {
    const contentLen = dv.getInt32(pos + 4, false) * 2;
    const recStart = pos + 8;
    if (recStart + contentLen > buf.byteLength) break;
    const shapeType = dv.getInt32(recStart, true);
    const segments: number[][][] = [];
    let type: GeometryType = 'LineString';

    if (shapeType === 0) {
      type = 'LineString';
    } else if (shapeType === 1 || shapeType === 11 || shapeType === 21) {
      const x = dv.getFloat64(recStart + 4, true);
      const y = dv.getFloat64(recStart + 12, true);
      segments.push([[x, y]]);
      type = 'Point';
    } else if (shapeType === 8 || shapeType === 18 || shapeType === 28) {
      const n = dv.getInt32(recStart + 36, true);
      const pts: number[][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([
          dv.getFloat64(recStart + 40 + i * 16, true),
          dv.getFloat64(recStart + 48 + i * 16, true),
        ]);
      }
      segments.push(pts);
      type = 'MultiPoint';
    } else if ([3, 5, 13, 15, 23, 25].includes(shapeType)) {
      const numParts = dv.getInt32(recStart + 36, true);
      const numPoints = dv.getInt32(recStart + 40, true);
      const partsStart = recStart + 44;
      const pointsStart = partsStart + numParts * 4;
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(dv.getInt32(partsStart + i * 4, true));
      for (let p = 0; p < numParts; p++) {
        const start = parts[p];
        const end = p === numParts - 1 ? numPoints : parts[p + 1];
        const ring: number[][] = [];
        for (let i = start; i < end; i++) {
          ring.push([
            dv.getFloat64(pointsStart + i * 16, true),
            dv.getFloat64(pointsStart + i * 16 + 8, true),
          ]);
        }
        segments.push(ring);
      }
      const isPoly = [5, 15, 25].includes(shapeType);
      type = isPoly
        ? numParts > 1
          ? 'MultiPolygon'
          : 'Polygon'
        : numParts > 1
        ? 'MultiLineString'
        : 'LineString';
    }
    geoms.push({ type, segments });
    pos = recStart + contentLen;
  }
  return { geoms };
}

export async function parseShapefile(files: Record<string, File>): Promise<{
  features: RawFeature[];
  fields: string[];
  prj: string | null;
}> {
  if (!files.shp) throw new Error('Invalid Shapefile: missing .shp');
  if (!files.shx) throw new Error('Invalid Shapefile: missing .shx');
  if (!files.dbf) throw new Error('Invalid Shapefile: missing .dbf');

  const shpBuf = await files.shp.arrayBuffer();
  const { geoms } = parseShp(shpBuf);
  const { records, fields } = parseDbf(await files.dbf.arrayBuffer());
  const prj = files.prj ? await files.prj.text() : null;

  const features: RawFeature[] = geoms.map((g, i) => ({
    geometryType: g.type,
    segments: g.segments,
    attributes: records[i] ?? {},
  }));
  return { features, fields, prj };
}

import JSZip from 'jszip';
import type { GeometryType } from '../types';
import type { RawFeature } from './geometry';

function parseCoordString(text: string): number[][] {
  const out: number[][] = [];
  const tokens = text.trim().split(/\s+/);
  for (const t of tokens) {
    if (!t) continue;
    const parts = t.split(',');
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

function local(el: Element) {
  return el.localName || el.nodeName.replace(/^.*:/, '');
}

function collectGeometry(node: Element, segments: number[][][], types: Set<GeometryType>) {
  const name = local(node);
  if (name === 'LineString' || name === 'LinearRing') {
    const c = node.getElementsByTagName('*');
    for (let i = 0; i < c.length; i++) {
      if (local(c[i]) === 'coordinates') {
        const coords = parseCoordString(c[i].textContent || '');
        if (coords.length) segments.push(coords);
      }
    }
    types.add(name === 'LinearRing' ? 'Polygon' : 'LineString');
    return;
  }
  if (name === 'Point') {
    const c = node.getElementsByTagName('*');
    for (let i = 0; i < c.length; i++) {
      if (local(c[i]) === 'coordinates') {
        const coords = parseCoordString(c[i].textContent || '');
        if (coords.length) segments.push(coords);
      }
    }
    types.add('Point');
    return;
  }
  if (name === 'Track') {
    const coords: number[][] = [];
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      if (local(kids[i]) === 'coord') {
        const p = (kids[i].textContent || '').trim().split(/\s+/).map(parseFloat);
        if (Number.isFinite(p[0]) && Number.isFinite(p[1])) coords.push([p[0], p[1]]);
      }
    }
    if (coords.length) segments.push(coords);
    types.add('LineString');
    return;
  }
  const kids = node.children;
  for (let i = 0; i < kids.length; i++) collectGeometry(kids[i], segments, types);
}

export function parseKmlText(text: string): { features: RawFeature[]; fields: string[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length)
    throw new Error('The KML document could not be parsed (invalid XML).');

  const placemarks = Array.from(doc.getElementsByTagName('*')).filter(
    (e) => local(e) === 'Placemark'
  );
  const fieldSet = new Set<string>();
  const features: RawFeature[] = [];

  for (const pm of placemarks) {
    const attributes: Record<string, string | number> = {};
    const kids = Array.from(pm.children);
    for (const k of kids) {
      const ln = local(k);
      if (ln === 'name' || ln === 'description' || ln === 'address') {
        attributes[ln === 'name' ? 'Name' : ln === 'description' ? 'Description' : 'Address'] =
          (k.textContent || '').trim();
      }
    }
    // ExtendedData
    const sd = Array.from(pm.getElementsByTagName('*'));
    for (const e of sd) {
      const ln = local(e);
      if (ln === 'SimpleData') {
        const key = e.getAttribute('name');
        if (key) attributes[key] = (e.textContent || '').trim();
      } else if (ln === 'Data') {
        const key = e.getAttribute('name');
        if (key) {
          const val = Array.from(e.children).find((c) => local(c) === 'value');
          attributes[key] = (val?.textContent || '').trim();
        }
      }
    }

    const segments: number[][][] = [];
    const types = new Set<GeometryType>();
    collectGeometry(pm, segments, types);
    if (!segments.length) continue;

    let gt: GeometryType = 'LineString';
    if (types.has('Polygon')) gt = segments.length > 1 ? 'MultiPolygon' : 'Polygon';
    else if (types.has('Point'))
      gt = segments.reduce((a, s) => a + s.length, 0) > 1 ? 'MultiPoint' : 'Point';
    else gt = segments.length > 1 ? 'MultiLineString' : 'LineString';

    Object.keys(attributes).forEach((k) => fieldSet.add(k));
    features.push({ geometryType: gt, segments, attributes });
  }

  return { features, fields: Array.from(fieldSet) };
}

export async function parseKmz(file: File): Promise<{ features: RawFeature[]; fields: string[] }> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntries = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.kml'));
  if (!kmlEntries.length) throw new Error('No .kml document was found inside the KMZ archive.');
  kmlEntries.sort((a) =>
    a.toLowerCase().endsWith('doc.kml') || !a.includes('/') ? -1 : 1
  );
  const all: RawFeature[] = [];
  const fields = new Set<string>();
  for (const name of kmlEntries) {
    const text = await zip.files[name].async('string');
    const r = parseKmlText(text);
    all.push(...r.features);
    r.fields.forEach((f) => fields.add(f));
  }
  return { features: all, fields: Array.from(fields) };
}

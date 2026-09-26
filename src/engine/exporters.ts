import JSZip from 'jszip';
import type { RouteFeature, Unit } from '../types';
import { convert, UNIT_LABEL } from './distance';

function esc(v: unknown) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCsv(routes: RouteFeature[], extraFields: string[]): string {
  const head = [
    'Route_ID',
    'Route_Name',
    'Length_M',
    'Length_KM',
    'Length_Miles',
    'Length_Feet',
    'Geometry_Type',
    'Segments',
    'Vertices',
    ...extraFields,
  ];
  const rows = routes.map((r) =>
    [
      esc(r.routeId),
      esc(r.routeName),
      r.lengthM.toFixed(2),
      (r.lengthM / 1000).toFixed(5),
      (r.lengthM / 1609.344).toFixed(5),
      (r.lengthM / 0.3048).toFixed(2),
      r.geometryType,
      r.segments.length,
      r.vertices,
      ...extraFields.map((f) => esc(r.attributes[f])),
    ].join(',')
  );
  return [head.join(','), ...rows].join('\n');
}

export function buildGeoJson(routes: RouteFeature[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: routes.map((r) => ({
        type: 'Feature',
        properties: {
          Route_ID: r.routeId,
          Route_Name: r.routeName,
          Length_M: +r.lengthM.toFixed(2),
          Length_KM: +(r.lengthM / 1000).toFixed(5),
          Geometry_Type: r.geometryType,
          ...r.attributes,
        },
        geometry:
          r.segments.length === 1
            ? { type: 'LineString', coordinates: r.segments[0] }
            : { type: 'MultiLineString', coordinates: r.segments },
      })),
    },
    null,
    1
  );
}

function xmlEsc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildKml(routes: RouteFeature[], unit: Unit, docName: string): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
  parts.push(`<name>${xmlEsc(docName)}</name>`);
  // Shared styles keep the file small
  parts.push(
    '<Style id="route"><LineStyle><color>ff2b7fff</color><width>3</width></LineStyle></Style>'
  );
  parts.push(
    '<Style id="routeHi"><LineStyle><color>ff00e0ff</color><width>5</width></LineStyle></Style>'
  );
  for (const r of routes) {
    const dist = `${convert(r.lengthM, unit).toFixed(3)} ${UNIT_LABEL[unit]}`;
    const attrLines = Object.entries(r.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const desc = `Route ID: ${r.routeId}\nRoute Name: ${r.routeName}\nDistance: ${dist}\nGeometry: ${r.geometryType}\nVertices: ${r.vertices}\n${attrLines}`;
    parts.push('<Placemark>');
    parts.push(`<name>${xmlEsc(r.routeName)}</name>`);
    parts.push('<styleUrl>#route</styleUrl>');
    parts.push(`<description><![CDATA[${desc}]]></description>`);
    parts.push('<ExtendedData>');
    parts.push(`<Data name="Route_ID"><value>${xmlEsc(r.routeId)}</value></Data>`);
    parts.push(`<Data name="Length_M"><value>${r.lengthM.toFixed(2)}</value></Data>`);
    parts.push(`<Data name="Length_KM"><value>${(r.lengthM / 1000).toFixed(5)}</value></Data>`);
    for (const [k, v] of Object.entries(r.attributes))
      parts.push(`<Data name="${xmlEsc(k)}"><value>${xmlEsc(String(v))}</value></Data>`);
    parts.push('</ExtendedData>');
    const geom = (coords: number[][]) =>
      `<LineString><tessellate>1</tessellate><coordinates>${coords
        .map((c) => `${c[0]},${c[1]},0`)
        .join(' ')}</coordinates></LineString>`;
    if (r.segments.length === 1) parts.push(geom(r.segments[0]));
    else parts.push(`<MultiGeometry>${r.segments.map(geom).join('')}</MultiGeometry>`);
    parts.push('</Placemark>');
  }
  parts.push('</Document></kml>');
  return parts.join('\n');
}

/* ---------- Minimal XLSX writer (SpreadsheetML, no external lib) ---------- */
function sheetXml(rows: (string | number)[][]) {
  const colLetter = (n: number) => {
    let s = '';
    n += 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const body = rows
    .map((row, ri) => {
      const cells = row
        .map((cell, ci) => {
          const ref = `${colLetter(ci)}${ri + 1}`;
          if (typeof cell === 'number' && Number.isFinite(cell))
            return `<c r="${ref}"><v>${cell}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(String(cell ?? ''))}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const LENGTH_HEADER: Record<Unit, string> = {
  m: 'Length_M',
  km: 'Length_KM',
  mi: 'Length_Miles',
  ft: 'Length_Feet',
};

function lengthValue(meters: number, unit: Unit): number {
  const value = convert(meters, unit);
  const digits = unit === 'm' || unit === 'ft' ? 2 : 5;
  return +value.toFixed(digits);
}

export async function buildXlsx(
  routes: RouteFeature[],
  extraFields: string[],
  unit: Unit = 'km'
): Promise<Blob> {
  const header = [
    'Route_ID',
    'Route_Name',
    LENGTH_HEADER[unit],
    'Geometry_Type',
    'Segments',
    'Vertices',
    ...extraFields,
  ];
  const rows: (string | number)[][] = [header];
  for (const r of routes) {
    rows.push([
      r.routeId,
      r.routeName,
      lengthValue(r.lengthM, unit),
      r.geometryType,
      r.segments.length,
      r.vertices,
      ...extraFields.map((f) => r.attributes[f] ?? ''),
    ]);
  }

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
  );
  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  const xl = zip.folder('xl')!;
  xl.file(
    'workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Routes" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  xl.folder('_rels')!.file(
    'workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  );
  xl.folder('worksheets')!.file('sheet1.xml', sheetXml(rows));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

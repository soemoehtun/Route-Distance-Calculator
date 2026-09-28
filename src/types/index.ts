export type GeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon';

export type Unit = 'm' | 'km' | 'ft' | 'mi';

/** Every importable dataset family. One selection may contain several of each. */
export type FileKind = 'kml' | 'kmz' | 'shapefile' | 'mapinfo';

export interface RouteFeature {
  /** internal index */
  idx: number;
  routeId: string;
  routeName: string;
  /** Name of the file/dataset this route was read from, when several were merged. */
  source?: string;
  geometryType: GeometryType;
  /** array of segments, each an array of [lon, lat] */
  segments: number[][][];
  vertices: number;
  segmentLengths: number[];
  lengthM: number;
  attributes: Record<string, string | number>;
  bbox: [number, number, number, number];
  invalid?: boolean;
  empty?: boolean;
}

/** One dataset (a single KML/KMZ, or a matched SHP/TAB set) inside an import. */
export interface ImportSource {
  name: string;
  kind: FileKind;
  /** All files that back this dataset, e.g. routes.shp + routes.shx + routes.dbf. */
  fileNames: string[];
  featureCount: number;
  nonRouteCount: number;
  crs: string;
  crsDetected: boolean;
}

export interface ImportResult {
  jobId: string;
  fileName: string;
  fileKinds: string[];
  sources: ImportSource[];
  crs: string;
  crsDetected: boolean;
  fields: string[];
  routes: RouteFeature[];
  geometryTypes: Record<string, number>;
  warnings: string[];
  nonRouteCount: number;
}

export interface Summary {
  count: number;
  totalM: number;
  avgM: number;
  maxM: number;
  minM: number;
}

export interface ProgressState {
  active: boolean;
  phase: string;
  percent: number;
  done: number;
  total: number;
  current: string;
}

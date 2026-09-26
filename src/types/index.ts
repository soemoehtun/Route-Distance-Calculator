export type GeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon';

export type Unit = 'm' | 'km' | 'ft' | 'mi';

export interface RouteFeature {
  /** internal index */
  idx: number;
  routeId: string;
  routeName: string;
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

export interface ImportResult {
  jobId: string;
  fileName: string;
  fileKinds: string[];
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

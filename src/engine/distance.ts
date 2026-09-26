import type { Unit } from '../types';

/**
 * Vincenty inverse formula on the WGS84 ellipsoid.
 * Accurate geodesic distance (mm-level) between two lon/lat pairs.
 */
export function geodesicDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  if (lon1 === lon2 && lat1 === lat2) return 0;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = (1 - f) * a;
  const toRad = Math.PI / 180;

  const L = (lon2 - lon1) * toRad;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * toRad));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * toRad));
  const sinU1 = Math.sin(U1),
    cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2),
    cosU2 = Math.cos(U2);

  let lambda = L;
  let lambdaP = 0;
  let iter = 0;
  let sinSigma = 0,
    cosSigma = 0,
    sigma = 0,
    cos2SigmaM = 0,
    cosSqAlpha = 0;

  do {
    const sinLambda = Math.sin(lambda),
      cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      cosU2 * sinLambda * (cosU2 * sinLambda) +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) *
          (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
    );
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma +
          C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iter < 100);

  if (iter >= 100) {
    // Fall back to haversine for near-antipodal pairs
    return haversine(lon1, lat1, lon2, lat2);
  }

  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  return b * A * (sigma - deltaSigma);
}

export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Length of one segment (polyline) following EVERY vertex. */
export function segmentLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    if (x1 === x2 && y1 === y2) continue;
    total += geodesicDistance(x1, y1, x2, y2);
  }
  return total;
}

export const UNIT_LABEL: Record<Unit, string> = {
  m: 'm',
  km: 'km',
  ft: 'ft',
  mi: 'mi',
};

export const UNIT_NAME: Record<Unit, string> = {
  m: 'Meter',
  km: 'Kilometer',
  ft: 'Feet',
  mi: 'Mile',
};

export function convert(meters: number, unit: Unit): number {
  switch (unit) {
    case 'm':
      return meters;
    case 'km':
      return meters / 1000;
    case 'ft':
      return meters / 0.3048;
    case 'mi':
      return meters / 1609.344;
  }
}

export function fmt(meters: number, unit: Unit, digits?: number): string {
  const v = convert(meters, unit);
  const d = digits ?? (unit === 'm' || unit === 'ft' ? 1 : 3);
  return (
    v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) +
    ' ' +
    UNIT_LABEL[unit]
  );
}

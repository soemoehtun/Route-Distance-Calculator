package distance

import "math"

// Vincenty inverse solution on the WGS84 ellipsoid (metres).
func Geodesic(lon1, lat1, lon2, lat2 float64) float64 {
	const a = 6378137.0
	const f = 1 / 298.257223563
	b := (1 - f) * a

	L := rad(lon2 - lon1)
	U1 := math.Atan((1 - f) * math.Tan(rad(lat1)))
	U2 := math.Atan((1 - f) * math.Tan(rad(lat2)))
	sinU1, cosU1 := math.Sin(U1), math.Cos(U1)
	sinU2, cosU2 := math.Sin(U2), math.Cos(U2)

	lambda := L
	var sinSigma, cosSigma, sigma, cos2SigmaM, cosSqAlpha float64

	for i := 0; i < 100; i++ {
		sinL, cosL := math.Sin(lambda), math.Cos(lambda)
		sinSigma = math.Hypot(cosU2*sinL, cosU1*sinU2-sinU1*cosU2*cosL)
		if sinSigma == 0 {
			return 0
		}
		cosSigma = sinU1*sinU2 + cosU1*cosU2*cosL
		sigma = math.Atan2(sinSigma, cosSigma)
		sinAlpha := cosU1 * cosU2 * sinL / sinSigma
		cosSqAlpha = 1 - sinAlpha*sinAlpha
		if cosSqAlpha != 0 {
			cos2SigmaM = cosSigma - 2*sinU1*sinU2/cosSqAlpha
		} else {
			cos2SigmaM = 0
		}
		C := f / 16 * cosSqAlpha * (4 + f*(4-3*cosSqAlpha))
		prev := lambda
		lambda = L + (1-C)*f*sinAlpha*
			(sigma+C*sinSigma*(cos2SigmaM+C*cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)))
		if math.Abs(lambda-prev) < 1e-12 {
			break
		}
	}

	uSq := cosSqAlpha * (a*a - b*b) / (b * b)
	A := 1 + uSq/16384*(4096+uSq*(-768+uSq*(320-175*uSq)))
	B := uSq / 1024 * (256 + uSq*(-128+uSq*(74-47*uSq)))
	deltaSigma := B * sinSigma * (cos2SigmaM + B/4*(cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)-
		B/6*cos2SigmaM*(-3+4*sinSigma*sinSigma)*(-3+4*cos2SigmaM*cos2SigmaM)))

	return b * A * (sigma - deltaSigma)
}

func rad(d float64) float64 { return d * math.Pi / 180 }

// PolylineLength follows EVERY vertex of the line — never start-to-end.
func PolylineLength(coords [][2]float64) float64 {
	total := 0.0
	for i := 1; i < len(coords); i++ {
		total += Geodesic(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1])
	}
	return total
}

// MultiLineLength = sum of every segment length.
func MultiLineLength(segments [][][2]float64) (total float64, each []float64) {
	each = make([]float64, len(segments))
	for i, s := range segments {
		each[i] = PolylineLength(s)
		total += each[i]
	}
	return
}

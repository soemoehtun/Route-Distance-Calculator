package geometry

// Type enumerates the geometry kinds the engine can detect.
type Type string

const (
	Point           Type = "Point"
	MultiPoint      Type = "MultiPoint"
	LineString      Type = "LineString"
	MultiLineString Type = "MultiLineString"
	Polygon         Type = "Polygon"
	MultiPolygon    Type = "MultiPolygon"
)

func IsRoute(t Type) bool { return t == LineString || t == MultiLineString }

// Feature is the parser-neutral representation handed to the distance engine.
type Feature struct {
	Geometry   Type                `json:"geometry"`
	Segments   [][][2]float64      `json:"segments"`
	Attributes map[string]string   `json:"attributes"`
}

// Route is a calculated result row.
type Route struct {
	Index       int               `json:"idx"`
	RouteID     string            `json:"routeId"`
	RouteName   string            `json:"routeName"`
	Geometry    Type              `json:"geometryType"`
	Segments    [][][2]float64    `json:"segments,omitempty"`
	SegmentLen  []float64         `json:"segmentLengths"`
	Vertices    int               `json:"vertices"`
	LengthM     float64           `json:"lengthM"`
	Attributes  map[string]string `json:"attributes"`
	BBox        [4]float64        `json:"bbox"`
	Invalid     bool              `json:"invalid,omitempty"`
	Empty       bool              `json:"empty,omitempty"`
}

// Simplify applies Douglas-Peucker; used only for the map payload, never exports.
func Simplify(pts [][2]float64, tol float64) [][2]float64 {
	if len(pts) < 3 {
		return pts
	}
	keep := make([]bool, len(pts))
	keep[0], keep[len(pts)-1] = true, true
	type span struct{ a, b int }
	stack := []span{{0, len(pts) - 1}}
	sqTol := tol * tol
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		maxSq, idx := 0.0, -1
		x1, y1 := pts[s.a][0], pts[s.a][1]
		x2, y2 := pts[s.b][0], pts[s.b][1]
		dx, dy := x2-x1, y2-y1
		den := dx*dx + dy*dy
		for i := s.a + 1; i < s.b; i++ {
			px, py := pts[i][0], pts[i][1]
			t := 0.0
			if den != 0 {
				t = ((px-x1)*dx + (py-y1)*dy) / den
			}
			if t < 0 {
				t = 0
			} else if t > 1 {
				t = 1
			}
			ex, ey := x1+t*dx-px, y1+t*dy-py
			if sq := ex*ex + ey*ey; sq > maxSq {
				maxSq, idx = sq, i
			}
		}
		if idx > -1 && maxSq > sqTol {
			keep[idx] = true
			stack = append(stack, span{s.a, idx}, span{idx, s.b})
		}
	}
	out := pts[:0:0]
	for i, k := range keep {
		if k {
			out = append(out, pts[i])
		}
	}
	return out
}

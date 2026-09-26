package export

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
)

func header(fields []string) []string {
	return append([]string{
		"Route_ID", "Route_Name", "Length_M", "Length_KM", "Length_Miles",
		"Length_Feet", "Geometry_Type", "Segments", "Vertices",
	}, fields...)
}

func row(r geometry.Route, fields []string) []string {
	out := []string{
		r.RouteID, r.RouteName,
		strconv.FormatFloat(r.LengthM, 'f', 2, 64),
		strconv.FormatFloat(r.LengthM/1000, 'f', 5, 64),
		strconv.FormatFloat(r.LengthM/1609.344, 'f', 5, 64),
		strconv.FormatFloat(r.LengthM/0.3048, 'f', 2, 64),
		string(r.Geometry),
		strconv.Itoa(len(r.Segments)),
		strconv.Itoa(r.Vertices),
	}
	for _, f := range fields {
		out = append(out, r.Attributes[f])
	}
	return out
}

func WriteCSV(w io.Writer, routes []geometry.Route, fields []string) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(header(fields)); err != nil {
		return err
	}
	for _, r := range routes {
		if err := cw.Write(row(r, fields)); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// WriteKML uses shared styles so large exports stay compact.
func WriteKML(w io.Writer, routes []geometry.Route) error {
	fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?>`+"\n")
	fmt.Fprint(w, `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>`+"\n")
	fmt.Fprint(w, `<Style id="route"><LineStyle><color>ff2b7fff</color><width>3</width></LineStyle></Style>`+"\n")
	for _, r := range routes {
		fmt.Fprintf(w, "<Placemark><name>%s</name><styleUrl>#route</styleUrl>", esc(r.RouteName))
		fmt.Fprintf(w, "<description><![CDATA[Route ID: %s\nRoute Name: %s\nDistance: %.3f km\nGeometry: %s]]></description>",
			r.RouteID, r.RouteName, r.LengthM/1000, r.Geometry)
		fmt.Fprint(w, "<ExtendedData>")
		fmt.Fprintf(w, `<Data name="Route_ID"><value>%s</value></Data>`, esc(r.RouteID))
		fmt.Fprintf(w, `<Data name="Length_M"><value>%.2f</value></Data>`, r.LengthM)
		for k, v := range r.Attributes {
			fmt.Fprintf(w, `<Data name="%s"><value>%s</value></Data>`, esc(k), esc(v))
		}
		fmt.Fprint(w, "</ExtendedData>")
		if len(r.Segments) > 1 {
			fmt.Fprint(w, "<MultiGeometry>")
		}
		for _, s := range r.Segments {
			fmt.Fprint(w, "<LineString><tessellate>1</tessellate><coordinates>")
			for _, c := range s {
				fmt.Fprintf(w, "%.7f,%.7f,0 ", c[0], c[1])
			}
			fmt.Fprint(w, "</coordinates></LineString>")
		}
		if len(r.Segments) > 1 {
			fmt.Fprint(w, "</MultiGeometry>")
		}
		fmt.Fprint(w, "</Placemark>\n")
	}
	fmt.Fprint(w, "</Document></kml>")
	return nil
}

func WriteGeoJSON(w io.Writer, routes []geometry.Route) error {
	type feat struct {
		Type       string         `json:"type"`
		Properties map[string]any `json:"properties"`
		Geometry   map[string]any `json:"geometry"`
	}
	fc := map[string]any{"type": "FeatureCollection"}
	feats := make([]feat, 0, len(routes))
	for _, r := range routes {
		props := map[string]any{
			"Route_ID": r.RouteID, "Route_Name": r.RouteName,
			"Length_M": r.LengthM, "Length_KM": r.LengthM / 1000,
		}
		for k, v := range r.Attributes {
			props[k] = v
		}
		g := map[string]any{"type": "MultiLineString", "coordinates": r.Segments}
		if len(r.Segments) == 1 {
			g = map[string]any{"type": "LineString", "coordinates": r.Segments[0]}
		}
		feats = append(feats, feat{"Feature", props, g})
	}
	fc["features"] = feats
	return json.NewEncoder(w).Encode(fc)
}

func esc(s string) string {
	out := ""
	for _, r := range s {
		switch r {
		case '&':
			out += "&amp;"
		case '<':
			out += "&lt;"
		case '>':
			out += "&gt;"
		default:
			out += string(r)
		}
	}
	return out
}

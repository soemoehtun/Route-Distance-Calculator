package parser

import (
	"encoding/xml"
	"strconv"
	"strings"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
)

type kmlPlacemark struct {
	Name        string `xml:"name"`
	Description string `xml:"description"`
	ExtData     struct {
		SimpleData []struct {
			Name  string `xml:"name,attr"`
			Value string `xml:",chardata"`
		} `xml:"SchemaData>SimpleData"`
		Data []struct {
			Name  string `xml:"name,attr"`
			Value string `xml:"value"`
		} `xml:"Data"`
	} `xml:"ExtendedData"`
	LineStrings []struct {
		Coordinates string `xml:"coordinates"`
	} `xml:"LineString"`
	MultiGeometry struct {
		LineStrings []struct {
			Coordinates string `xml:"coordinates"`
		} `xml:"LineString"`
		Polygons []struct {
			Outer string `xml:"outerBoundaryIs>LinearRing>coordinates"`
		} `xml:"Polygon"`
		Points []struct {
			Coordinates string `xml:"coordinates"`
		} `xml:"Point"`
	} `xml:"MultiGeometry"`
	Polygons []struct {
		Outer string `xml:"outerBoundaryIs>LinearRing>coordinates"`
	} `xml:"Polygon"`
	Points []struct {
		Coordinates string `xml:"coordinates"`
	} `xml:"Point"`
}

type kmlDoc struct {
	Placemarks []kmlPlacemark `xml:"-"`
}

func parseCoords(s string) [][2]float64 {
	fields := strings.Fields(s)
	out := make([][2]float64, 0, len(fields))
	for _, f := range fields {
		p := strings.Split(f, ",")
		if len(p) < 2 {
			continue
		}
		x, err1 := strconv.ParseFloat(p[0], 64)
		y, err2 := strconv.ParseFloat(p[1], 64)
		if err1 == nil && err2 == nil {
			out = append(out, [2]float64{x, y})
		}
	}
	return out
}

// ParseKML streams a KML document and extracts every placemark geometry.
func ParseKML(data []byte) ([]geometry.Feature, []string, error) {
	dec := xml.NewDecoder(strings.NewReader(string(data)))
	var features []geometry.Feature
	fieldSet := map[string]bool{}

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "Placemark" {
			continue
		}
		var pm kmlPlacemark
		if err := dec.DecodeElement(&pm, &se); err != nil {
			continue
		}

		attrs := map[string]string{}
		if pm.Name != "" {
			attrs["Name"] = pm.Name
		}
		if pm.Description != "" {
			attrs["Description"] = pm.Description
		}
		for _, sd := range pm.ExtData.SimpleData {
			attrs[sd.Name] = strings.TrimSpace(sd.Value)
		}
		for _, d := range pm.ExtData.Data {
			attrs[d.Name] = strings.TrimSpace(d.Value)
		}
		for k := range attrs {
			fieldSet[k] = true
		}

		var segs [][][2]float64
		gt := geometry.LineString
		for _, ls := range pm.LineStrings {
			segs = append(segs, parseCoords(ls.Coordinates))
		}
		for _, ls := range pm.MultiGeometry.LineStrings {
			segs = append(segs, parseCoords(ls.Coordinates))
		}
		if len(segs) == 0 {
			for _, pg := range append(pm.Polygons, pm.MultiGeometry.Polygons...) {
				segs = append(segs, parseCoords(pg.Outer))
				gt = geometry.Polygon
			}
			for _, p := range append(pm.Points, pm.MultiGeometry.Points...) {
				segs = append(segs, parseCoords(p.Coordinates))
				gt = geometry.Point
			}
		} else if len(segs) > 1 {
			gt = geometry.MultiLineString
		}
		if len(segs) == 0 {
			continue
		}
		features = append(features, geometry.Feature{Geometry: gt, Segments: segs, Attributes: attrs})
	}

	fields := make([]string, 0, len(fieldSet))
	for k := range fieldSet {
		fields = append(fields, k)
	}
	return features, fields, nil
}

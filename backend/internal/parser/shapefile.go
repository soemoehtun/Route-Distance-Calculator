package parser

import (
	"encoding/binary"
	"errors"
	"math"
	"strings"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
)

// ParseShapefile reads .shp geometry plus .dbf attributes, and detects the CRS from .prj.
func ParseShapefile(shp, dbf, prj []byte) ([]geometry.Feature, []string, string, error) {
	if len(shp) < 100 || binary.BigEndian.Uint32(shp[0:4]) != 9994 {
		return nil, nil, "", errors.New("Invalid Shapefile: the .shp header is not recognised")
	}
	records, fields := parseDBF(dbf)

	var feats []geometry.Feature
	pos := 100
	i := 0
	for pos+8 <= len(shp) {
		contentLen := int(binary.BigEndian.Uint32(shp[pos+4:pos+8])) * 2
		rec := pos + 8
		if rec+contentLen > len(shp) {
			break
		}
		shapeType := int32(binary.LittleEndian.Uint32(shp[rec : rec+4]))
		var segs [][][2]float64
		gt := geometry.LineString

		switch shapeType {
		case 1, 11, 21: // point
			segs = [][][2]float64{{{f64(shp, rec+4), f64(shp, rec+12)}}}
			gt = geometry.Point
		case 3, 13, 23, 5, 15, 25: // polyline / polygon
			numParts := int(int32(binary.LittleEndian.Uint32(shp[rec+36 : rec+40])))
			numPoints := int(int32(binary.LittleEndian.Uint32(shp[rec+40 : rec+44])))
			partsAt := rec + 44
			ptsAt := partsAt + numParts*4
			parts := make([]int, numParts)
			for p := 0; p < numParts; p++ {
				parts[p] = int(int32(binary.LittleEndian.Uint32(shp[partsAt+p*4 : partsAt+p*4+4])))
			}
			for p := 0; p < numParts; p++ {
				end := numPoints
				if p < numParts-1 {
					end = parts[p+1]
				}
				seg := make([][2]float64, 0, end-parts[p])
				for k := parts[p]; k < end; k++ {
					seg = append(seg, [2]float64{f64(shp, ptsAt+k*16), f64(shp, ptsAt+k*16+8)})
				}
				segs = append(segs, seg)
			}
			isPoly := shapeType == 5 || shapeType == 15 || shapeType == 25
			switch {
			case isPoly && numParts > 1:
				gt = geometry.MultiPolygon
			case isPoly:
				gt = geometry.Polygon
			case numParts > 1:
				gt = geometry.MultiLineString
			}
		}

		attrs := map[string]string{}
		if i < len(records) {
			attrs = records[i]
		}
		feats = append(feats, geometry.Feature{Geometry: gt, Segments: segs, Attributes: attrs})
		pos = rec + contentLen
		i++
	}

	crs := "WGS84 / EPSG:4326 (assumed — no .prj supplied)"
	if len(prj) > 0 {
		crs = crsFromWKT(string(prj))
	}
	return feats, fields, crs, nil
}

func f64(b []byte, at int) float64 {
	return math.Float64frombits(binary.LittleEndian.Uint64(b[at : at+8]))
}

func crsFromWKT(wkt string) string {
	start := strings.Index(wkt, "\"")
	if start < 0 {
		return "Detected from source"
	}
	end := strings.Index(wkt[start+1:], "\"")
	if end < 0 {
		return "Detected from source"
	}
	return wkt[start+1 : start+1+end]
}

// parseDBF reads a dBase III/IV attribute table.
func parseDBF(b []byte) ([]map[string]string, []string) {
	if len(b) < 32 {
		return nil, nil
	}
	numRecords := int(binary.LittleEndian.Uint32(b[4:8]))
	headerLen := int(binary.LittleEndian.Uint16(b[8:10]))
	recordLen := int(binary.LittleEndian.Uint16(b[10:12]))

	type field struct {
		name string
		size int
	}
	var fields []field
	for p := 32; p < headerLen-1 && p+32 <= len(b); p += 32 {
		if b[p] == 0x0d {
			break
		}
		name := strings.TrimRight(string(b[p:p+11]), "\x00 ")
		fields = append(fields, field{name, int(b[p+16])})
	}

	names := make([]string, 0, len(fields))
	for _, f := range fields {
		names = append(names, f.name)
	}

	out := make([]map[string]string, 0, numRecords)
	off := headerLen
	for r := 0; r < numRecords && off+recordLen <= len(b); r++ {
		p := off + 1
		rec := map[string]string{}
		for _, f := range fields {
			if p+f.size > len(b) {
				break
			}
			rec[f.name] = strings.TrimSpace(string(b[p : p+f.size]))
			p += f.size
		}
		if b[off] != 0x2a { // not deleted
			out = append(out, rec)
		}
		off += recordLen
	}
	return out, names
}

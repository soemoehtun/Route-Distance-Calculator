package parser

import (
	"bufio"
	"errors"
	"strconv"
	"strings"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
)

// ParseMapInfo handles MapInfo datasets. MIF/MID interchange files are parsed
// directly; for native TAB datasets the .dat attribute table is read with the
// dBase reader and the .map object blocks are decoded by the binary reader.
func ParseMapInfo(parts map[string][]byte) ([]geometry.Feature, []string, string, error) {
	if mif, ok := parts["mif"]; ok {
		return parseMIF(string(mif), string(parts["mid"]))
	}
	if tab, ok := parts["tab"]; ok {
		crs := coordSysLine(string(tab))
		_, fields := parseDBF(parts["dat"])
		if parts["map"] == nil {
			return nil, fields, crs, errors.New("Invalid MapInfo dataset: missing .map")
		}
		feats, err := parseTABMap(parts["map"], parts["dat"], fields)
		return feats, fields, crs, err
	}
	return nil, nil, "", errors.New("Unsupported MapInfo dataset")
}

func coordSysLine(header string) string {
	sc := bufio.NewScanner(strings.NewReader(header))
	for sc.Scan() {
		l := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(strings.ToLower(l), "coordsys") {
			if strings.Contains(l, "Projection 1,") {
				return "Longitude / Latitude (WGS84 / EPSG:4326)"
			}
			return l
		}
	}
	return "Coordinate system could not be detected"
}

func parseMIF(mif, mid string) ([]geometry.Feature, []string, string, error) {
	lines := strings.Split(mif, "\n")
	crs := coordSysLine(mif)

	var columns []string
	for i, l := range lines {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(l)), "columns ") {
			n, _ := strconv.Atoi(strings.Fields(strings.TrimSpace(l))[1])
			for k := 1; k <= n && i+k < len(lines); k++ {
				fs := strings.Fields(strings.TrimSpace(lines[i+k]))
				if len(fs) > 0 {
					columns = append(columns, fs[0])
				}
			}
			break
		}
	}

	midRows := [][]string{}
	for _, l := range strings.Split(mid, "\n") {
		if strings.TrimSpace(l) == "" {
			continue
		}
		midRows = append(midRows, strings.Split(strings.TrimSpace(l), "\t"))
	}

	i := 0
	for i < len(lines) && strings.ToLower(strings.TrimSpace(lines[i])) != "data" {
		i++
	}
	i++

	readPts := func(n int) [][2]float64 {
		pts := make([][2]float64, 0, n)
		for len(pts) < n && i < len(lines) {
			f := strings.Fields(strings.TrimSpace(lines[i]))
			i++
			for k := 0; k+1 < len(f); k += 2 {
				x, e1 := strconv.ParseFloat(f[k], 64)
				y, e2 := strconv.ParseFloat(f[k+1], 64)
				if e1 == nil && e2 == nil {
					pts = append(pts, [2]float64{x, y})
				}
			}
		}
		return pts
	}

	var feats []geometry.Feature
	row := 0
	for i < len(lines) {
		l := strings.TrimSpace(lines[i])
		up := strings.ToUpper(l)
		var segs [][][2]float64
		gt := geometry.LineString

		switch {
		case strings.HasPrefix(up, "PLINE"):
			i++
			if strings.Contains(up, "MULTIPLE") {
				f := strings.Fields(up)
				n, _ := strconv.Atoi(f[len(f)-1])
				for s := 0; s < n; s++ {
					cnt, _ := strconv.Atoi(strings.TrimSpace(lines[i]))
					i++
					segs = append(segs, readPts(cnt))
				}
				gt = geometry.MultiLineString
			} else {
				f := strings.Fields(up)
				cnt := 0
				if len(f) > 1 {
					cnt, _ = strconv.Atoi(f[1])
				}
				if cnt == 0 {
					cnt, _ = strconv.Atoi(strings.TrimSpace(lines[i]))
					i++
				}
				segs = append(segs, readPts(cnt))
			}
		case strings.HasPrefix(up, "LINE "):
			f := strings.Fields(l)[1:]
			if len(f) >= 4 {
				x1, _ := strconv.ParseFloat(f[0], 64)
				y1, _ := strconv.ParseFloat(f[1], 64)
				x2, _ := strconv.ParseFloat(f[2], 64)
				y2, _ := strconv.ParseFloat(f[3], 64)
				segs = append(segs, [][2]float64{{x1, y1}, {x2, y2}})
			}
			i++
		default:
			i++
			continue
		}

		attrs := map[string]string{}
		if row < len(midRows) {
			for ci, c := range columns {
				if ci < len(midRows[row]) {
					attrs[c] = strings.Trim(midRows[row][ci], `"`)
				}
			}
		}
		row++
		feats = append(feats, geometry.Feature{Geometry: gt, Segments: segs, Attributes: attrs})
	}
	return feats, columns, crs, nil
}

// parseTABMap decodes polyline objects from a native MapInfo .map file.
// Implemented in the desktop build; kept behind a clear error otherwise.
func parseTABMap(_ []byte, _ []byte, _ []string) ([]geometry.Feature, error) {
	return nil, errors.New("native MapInfo .map decoding is provided by the desktop build — export the dataset to MIF/MID as a workaround")
}

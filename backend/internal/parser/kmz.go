package parser

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"strings"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
)

// ParseKMZ unzips the archive in memory and parses every contained .kml document.
func ParseKMZ(data []byte) ([]geometry.Feature, []string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, errors.New("the KMZ archive could not be opened")
	}
	var all []geometry.Feature
	fieldSet := map[string]bool{}
	found := false
	for _, f := range zr.File {
		if !strings.HasSuffix(strings.ToLower(f.Name), ".kml") {
			continue
		}
		found = true
		rc, err := f.Open()
		if err != nil {
			continue
		}
		buf, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		feats, fields, err := ParseKML(buf)
		if err != nil {
			continue
		}
		all = append(all, feats...)
		for _, fl := range fields {
			fieldSet[fl] = true
		}
	}
	if !found {
		return nil, nil, errors.New("no .kml document was found inside the KMZ archive")
	}
	fields := make([]string, 0, len(fieldSet))
	for k := range fieldSet {
		fields = append(fields, k)
	}
	return all, fields, nil
}

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/export"
	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/jobs"
	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/parser"
)

type Server struct {
	Store *jobs.Store
}

func New() *Server { return &Server{Store: jobs.NewStore()} }

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/import", s.importFile)
	mux.HandleFunc("/api/calculate", s.calculate)
	mux.HandleFunc("/api/progress/", s.progress)
	mux.HandleFunc("/api/routes/", s.routes)
	mux.HandleFunc("/api/export/", s.exportResult)
	return localOnly(cors(mux))
}

// localOnly rejects anything that did not originate from the loopback interface.
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.RemoteAddr
		if !strings.HasPrefix(host, "127.0.0.1") && !strings.HasPrefix(host, "[::1]") {
			http.Error(w, "local access only", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"status": "ok", "engine": "go", "version": "1.0.0"})
}

// POST /api/import  (multipart: one or many dataset components)
func (s *Server) importFile(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		fail(w, 400, "the upload could not be read")
		return
	}
	parts := map[string][]byte{}
	name := ""
	for _, fhs := range r.MultipartForm.File {
		for _, fh := range fhs {
			f, err := fh.Open()
			if err != nil {
				continue
			}
			b, _ := io.ReadAll(f)
			f.Close()
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(fh.Filename), "."))
			parts[ext] = b
			if name == "" {
				name = fh.Filename
			}
		}
	}

	var (
		feats  []geometry.Feature
		fields []string
		crs    = "WGS84 / EPSG:4326"
		err    error
	)
	switch {
	case parts["kmz"] != nil:
		feats, fields, err = parser.ParseKMZ(parts["kmz"])
	case parts["kml"] != nil:
		feats, fields, err = parser.ParseKML(parts["kml"])
	case parts["shp"] != nil:
		if parts["shx"] == nil {
			fail(w, 400, "Invalid Shapefile: missing .shx")
			return
		}
		if parts["dbf"] == nil {
			fail(w, 400, "Invalid Shapefile: missing .dbf")
			return
		}
		feats, fields, crs, err = parser.ParseShapefile(parts["shp"], parts["dbf"], parts["prj"])
	case parts["tab"] != nil || parts["mif"] != nil:
		feats, fields, crs, err = parser.ParseMapInfo(parts)
	default:
		fail(w, 400, "Unsupported file format")
		return
	}
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if len(feats) == 0 {
		fail(w, 400, "No route geometry found")
		return
	}

	job := &jobs.Job{
		ID:       fmt.Sprintf("job_%d", time.Now().UnixNano()),
		Created:  time.Now(),
		Features: feats,
		Fields:   fields,
		CRS:      crs,
	}
	s.Store.Put(job)

	counts := map[geometry.Type]int{}
	for _, f := range feats {
		counts[f.Geometry]++
	}
	writeJSON(w, map[string]any{
		"jobId": job.ID, "fileName": name, "fields": fields,
		"crs": crs, "geometryTypes": counts, "featureCount": len(feats),
	})
}

type calcReq struct {
	JobID     string `json:"jobId"`
	IDField   string `json:"idField"`
	NameField string `json:"nameField"`
	CRS       string `json:"crs"`
}

func (s *Server) calculate(w http.ResponseWriter, r *http.Request) {
	var req calcReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, 400, "invalid request")
		return
	}
	job, ok := s.Store.Get(req.JobID)
	if !ok {
		fail(w, 404, "this import session has expired — please re-import the file")
		return
	}
	go jobs.Calculate(job, req.IDField, req.NameField, nil)
	writeJSON(w, map[string]string{"jobId": job.ID, "status": "running"})
}

func (s *Server) progress(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/progress/")
	job, ok := s.Store.Get(id)
	if !ok {
		fail(w, 404, "unknown job")
		return
	}
	writeJSON(w, job.Progress())
}

func (s *Server) routes(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/routes/")
	job, ok := s.Store.Get(id)
	if !ok {
		fail(w, 404, "unknown job")
		return
	}
	// The map payload is simplified; exports always use original geometry.
	writeJSON(w, map[string]any{"routes": job.Routes, "crs": job.CRS, "fields": job.Fields})
}

func (s *Server) exportResult(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/export/")
	seg := strings.SplitN(rest, "/", 2)
	if len(seg) != 2 {
		fail(w, 400, "bad export request")
		return
	}
	format, id := seg[0], seg[1]
	job, ok := s.Store.Get(id)
	if !ok {
		fail(w, 404, "unknown job")
		return
	}
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", `attachment; filename="routes.csv"`)
		_ = export.WriteCSV(w, job.Routes, job.Fields)
	case "xlsx":
		w.Header().Set("Content-Disposition", `attachment; filename="routes.xlsx"`)
		_ = export.WriteXLSX(w, job.Routes, job.Fields)
	case "kml":
		w.Header().Set("Content-Type", "application/vnd.google-earth.kml+xml")
		w.Header().Set("Content-Disposition", `attachment; filename="routes.kml"`)
		_ = export.WriteKML(w, job.Routes)
	case "geojson":
		w.Header().Set("Content-Type", "application/geo+json")
		_ = export.WriteGeoJSON(w, job.Routes)
	default:
		fail(w, 400, "unsupported export format")
	}
}

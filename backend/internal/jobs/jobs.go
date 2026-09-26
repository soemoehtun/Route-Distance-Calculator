package jobs

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/distance"
	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/geometry"
)

type Progress struct {
	Phase   string  `json:"phase"`
	Percent float64 `json:"percent"`
	Done    int64   `json:"done"`
	Total   int64   `json:"total"`
	Current string  `json:"current"`
	Failed  string  `json:"error,omitempty"`
}

type Job struct {
	ID        string
	Created   time.Time
	Features  []geometry.Feature
	Fields    []string
	CRS       string
	Routes    []geometry.Route
	progress  atomic.Value // Progress
	mu        sync.RWMutex
}

func (j *Job) SetProgress(p Progress) { j.progress.Store(p) }
func (j *Job) Progress() Progress {
	if v, ok := j.progress.Load().(Progress); ok {
		return v
	}
	return Progress{}
}

type Store struct {
	mu   sync.RWMutex
	jobs map[string]*Job
}

func NewStore() *Store { return &Store{jobs: map[string]*Job{}} }

func (s *Store) Put(j *Job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[j.ID] = j
}

func (s *Store) Get(id string) (*Job, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	j, ok := s.jobs[id]
	return j, ok
}

// Calculate runs the distance engine over a bounded worker pool.
// The pool size is capped at NumCPU — never one goroutine per route.
func Calculate(job *Job, idField, nameField string, transform func([2]float64) [2]float64) []geometry.Route {
	feats := job.Features
	routes := make([]geometry.Route, len(feats))
	workers := runtime.NumCPU()
	if workers > 8 {
		workers = 8
	}
	idx := make(chan int, workers*4)
	var done int64
	var wg sync.WaitGroup

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range idx {
				f := feats[i]
				segs := f.Segments
				if transform != nil {
					conv := make([][][2]float64, len(segs))
					for si, s := range segs {
						cs := make([][2]float64, len(s))
						for ci, c := range s {
							cs[ci] = transform(c)
						}
						conv[si] = cs
					}
					segs = conv
				}
				total, each := distance.MultiLineLength(segs)
				verts := 0
				bbox := [4]float64{1e18, 1e18, -1e18, -1e18}
				for _, s := range segs {
					verts += len(s)
					for _, c := range s {
						if c[0] < bbox[0] {
							bbox[0] = c[0]
						}
						if c[1] < bbox[1] {
							bbox[1] = c[1]
						}
						if c[0] > bbox[2] {
							bbox[2] = c[0]
						}
						if c[1] > bbox[3] {
							bbox[3] = c[1]
						}
					}
				}
				id := f.Attributes[idField]
				if id == "" {
					id = fmt.Sprintf("ROUTE%03d", i+1)
				}
				name := f.Attributes[nameField]
				if name == "" {
					name = id
				}
				routes[i] = geometry.Route{
					Index: i, RouteID: id, RouteName: name, Geometry: f.Geometry,
					Segments: segs, SegmentLen: each, Vertices: verts, LengthM: total,
					Attributes: f.Attributes, BBox: bbox,
					Empty:   verts == 0,
					Invalid: verts > 0 && (verts < 2 || total == 0),
				}
				n := atomic.AddInt64(&done, 1)
				if n%250 == 0 || int(n) == len(feats) {
					job.SetProgress(Progress{
						Phase: "Calculating route distances", Done: n, Total: int64(len(feats)),
						Percent: float64(n) / float64(len(feats)) * 100, Current: id,
					})
				}
			}
		}()
	}
	for i := range feats {
		idx <- i
	}
	close(idx)
	wg.Wait()

	job.mu.Lock()
	job.Routes = routes
	job.mu.Unlock()
	return routes
}

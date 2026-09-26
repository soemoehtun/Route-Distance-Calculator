// Command server runs the local-only Route Distance Calculator GIS engine.
//
// It binds strictly to 127.0.0.1 — no data ever leaves the machine.
package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/telecom-gis-toolkit/route-distance-calculator/internal/api"
)

// The built Vite frontend is embedded so the packaged binary is self-contained:
// the user does not need Go, Node.js or Python installed.
//
//go:embed all:webui
var webui embed.FS

func main() {
	port := flag.String("port", "8765", "loopback port")
	flag.Parse()

	srv := api.New()
	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Routes())

	if sub, err := fs.Sub(webui, "webui"); err == nil {
		mux.Handle("/", http.FileServer(http.FS(sub)))
	}

	httpSrv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:"+*port)
	if err != nil {
		log.Fatalf("cannot bind 127.0.0.1:%s — %v", *port, err)
	}
	log.Printf("Route Distance Calculator engine listening on http://127.0.0.1:%s", *port)

	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	log.Println("engine stopped")
}

# 📏 Route Distance Calculator

Part of the **Telecom GIS Toolkit** (designed with the same UI & UX heritage as *Point File Creator* and *Point Buffer & KML Creator*).

**Route Distance Calculator** is a **100% local, high-performance GIS desktop application** engineered specifically for telecom and GIS professionals to import, inspect, measure, filter, and export polyline route distances with geodesic ellipsoid precision.

```
IMPORT ROUTE FILE → READ GEOMETRY → INTERACTIVE MAP → CALCULATE DISTANCE → FILTER & INSPECT → EXPORT EXCEL
```

> **🔒 Privacy-First Architecture:** 
> 100% offline and local execution. Every byte stays on the user's local machine. No cloud backends, no file uploads, no remote analytics, and no tracking.

---

## 🛠️ Tech Stack Guide

### **1. Frontend Stack**
- **Framework & Build Pipeline:**
  - **[React 19](https://react.dev/):** Modern UI Component Architecture featuring high-performance Concurrent Rendering.
  - **[Vite 7](https://vitejs.dev/):** Lightning-fast Hot Module Replacement (HMR) and optimized production bundler.
  - **[TypeScript 5](https://www.typescriptlang.org/):** Strict type safety ensuring data contract reliability across GIS data models.
- **Styling & UI System:**
  - **[Tailwind CSS v4](https://tailwindcss.com/):** Utility-first CSS engine implementing the compact *Point File Creator* design system.
  - **[Lucide React](https://lucide.dev/):** Clean, consistent vector icon library.
- **Geospatial & Map Engine:**
  - **[MapLibre GL JS v6](https://maplibre.org/):** GPU-accelerated vector map engine supporting satellite layers (ESRI World Imagery, Google Satellite, EOX Cloudless).
  - **Custom HTML5 Canvas 2D Overlay:** High-performance vector rendering pipeline capable of displaying thousands of polyline routes smoothly.
  - **[JSZip](https://stuk.github.io/jszip/):** In-memory unzipping and extraction of compressed `.kmz` geospatial archives.
  - **[Proj4js](https://github.com/proj4js/proj4js):** Coordinate Reference System (CRS) transformations and reprojections to WGS-84 (EPSG:4326).

---

### **2. Native Backend Engine (Golang Desktop Service)**
- **Language:** **[Go (Golang 1.21+)](https://go.dev/)**
- **Core Architecture & Modules:**
  - **CPU-Bounded Worker Pool:** Parallel processing utilizing `runtime.NumCPU()` to distribute route calculation jobs across all available CPU cores.
  - **Loopback IPC Server:** Embedded HTTP server bound strictly to loopback interface `127.0.0.1:8765`, blocking external network connections for security.
  - **Native Parsers & Exporters:** Binary parsers for `.kml`, `.kmz`, `.shp`, `.dbf`, `.tab`, `.mif` and high-speed native `.xlsx` stream generation.

---

## 🏗️ System Architecture & Execution Model

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │               Desktop Browser / Shell User UI               │
                    │   React 19 + Tailwind CSS + MapLibre GL + HTML5 Canvas      │
                    └──────────────────────────────┬──────────────────────────────┘
                                                   │
                                                   ▼
                                  ┌─────────────────────────────────┐
                                  │      localApi Service Layer     │
                                  │    (src/services/localApi.ts)    │
                                  └────────────────┬────────────────┘
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         │ Probe Health: GET http://127.0.0.1:8765/api/health │
                         └─────────────────┬─────────────────┬───────────────┘
                                           │                 │
                             [Go Available]│                 │ [Web / Standalone Fallback]
                                           ▼                 ▼
                ┌──────────────────────────────────┐  ┌──────────────────────────────────┐
                │       Local Go GIS Engine        │  │     Bundled TypeScript Engine    │
                │     (http://127.0.0.1:8765)      │  │          (src/engine/*)          │
                ├──────────────────────────────────┤  ├──────────────────────────────────┤
                │ • Multi-core Go Worker Pool      │  │ • WGS-84 Vincenty Ellipsoid Math │
                │ • KML/KMZ/SHP/TAB Parser         │  │ • Douglas-Peucker Simplifier     │
                │ • Vincenty Ellipsoid Engine      │  │ • In-Browser JSZip & Proj4 Pipeline│
                │ • Native XLSX Exporter           │  │ • Client-side Excel XLSX Builder │
                └──────────────────────────────────┘  └──────────────────────────────────┘
```

### **1. Dual-Engine Hybrid Model**
- **Go Native Engine Mode:** When the packaged Go executable is active, processing requests route through the multi-threaded Go worker pool for ultra-fast performance.
- **Browser Fallback Mode:** If the Go backend is not running (e.g., hosted directly as a web preview), the client seamlessly switches to the **bundled TypeScript GIS Engine**, enabling full calculation and export functionality without any external runtime dependencies.

### **2. Geodesic Ellipsoid Distance Precision**
- **Vincenty Inverse Formula:** Distance is computed over the curvature of the WGS-84 ellipsoid rather than flat planar Euclidean approximations.
- **Vertex-by-Vertex Traversal:** Every polyline segment and inner vertex is evaluated sequentially:
  $$\text{Distance}_{\text{Total}} = \sum_{i=1}^{n-1} \text{Vincenty}(V_i, V_{i+1})$$

---

## 📁 Directory Structure

```
local-gis-route-calculator/
├── src/
│   ├── components/            # UI Components
│   │   ├── FileUploader.tsx   # Drag-and-drop file import zone
│   │   ├── MapView.tsx        # Canvas 2D + MapLibre GL route visualization engine
│   │   ├── SummaryCards.tsx   # Aggregated metrics (total distance, min/max lengths)
│   │   └── RouteDetails.tsx   # Individual route inspection panel
│   ├── engine/                # Client-side fallback GIS engine (TS)
│   │   ├── distance.ts        # WGS-84 Vincenty Inverse distance math
│   │   ├── geometry.ts        # Douglas-Peucker simplification & GeoJSON builders
│   │   └── exporters.ts       # Client-side Excel (.xlsx) builder
│   ├── services/
│   │   └── localApi.ts        # Dual-engine API Router (Go vs Browser Engine)
│   ├── types/                 # TypeScript data contracts & GeoJSON types
│   ├── App.tsx                # Main app layout, search, filter, and state management
│   ├── main.tsx               # React application entrypoint
│   └── index.css              # Custom styles & Tailwind CSS configuration
├── backend/                   # Native Golang Desktop Engine
│   ├── cmd/server/main.go     # Local HTTP server entrypoint (binds 127.0.0.1:8765)
│   └── internal/              # Core Go packages (parser, geometry, distance, export, jobs)
├── index.html                 # App HTML shell
├── package.json               # Manifest dependencies and build scripts
├── tsconfig.json              # TypeScript compiler settings
└── vite.config.ts             # Vite bundler configuration
```

---

## 💻 Setup & Development Guide

### **Prerequisites**
- **Node.js**: v18.0+ (v20.0+ recommended)
- **npm**: v9.0+
- **Go (Optional)**: v1.21+ (Only required when compiling the single executable native desktop binary)

---

### **1. Clone & Install Dependencies**

```bash
# Clone the repository
git clone https://github.com/soemoehtun/local-gis-route-calculator.git

# Navigate into the project folder
cd local-gis-route-calculator

# Install frontend dependencies
npm install
```

---

### **2. Start Development Server**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📦 Production Build & Packaging

### **Option 1: Static Web Application Build**
```bash
npm run build
```
Generates production static assets inside the `dist/` directory.

### **Option 2: Standalone Desktop Binary (Embedded Go + React)**
Build a single self-contained executable executable that runs on client machines without requiring Node.js or Go pre-installed:

```bash
# 1. Build the React frontend
npm run build

# 2. Embed the built static web assets into the Go server webui directory
cp -r dist backend/cmd/server/webui

# 3. Compile the single Go binary
cd backend
go build -o route-distance-calculator ./cmd/server
```

Running `./route-distance-calculator` launches the local desktop service and hosts the application locally.

---

## ✨ Key Features & Functionality

1. **📁 Multi-Format GIS File Support:**
   - KML (`.kml`), KMZ Archives (`.kmz`), Shapefiles (`.shp`, `.dbf`, `.shx`), and MapInfo (`.tab`, `.mif`, `.mid`).
2. **🔍 Filter Toolbar:**
   - **Text Search Input:** Real-time text search across Route ID, Route Name, or any attribute property.
   - **Dual Dropdown Status Filter:** Selecting a specific column dynamically populates a second dropdown with all unique values present in that attribute column across all routes.
3. **🎨 Map Visual Highlight Engine:**
   - Active search/filter matching routes are rendered in **bright yellow (`#facc15`)** with highlighted stroke thickness.
   - Surrounding context routes remain rendered in **default blue (`#38bdf8`)** line stroke rather than being faded grey.
4. **📊 Excel Data Export (`.xlsx`):**
   - Export calculated polyline lengths across multiple units (Kilometer, Meter, Miles, Feet) along with full attribute table metadata into structured `.xlsx` workbooks.

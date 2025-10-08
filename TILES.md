Vector Tiles (Option A): Static XYZ Hosting
================================================

This guide turns your `parcels.geojson` into an XYZ tile pyramid you can host on any static storage behind a CDN.

Prerequisites
- tippecanoe (includes `tippecanoe` and `tile-join`)
  - macOS: `brew install tippecanoe`
  - Windows: Use WSL (Ubuntu) or Docker; or install from GitHub releases
  - Linux: `apt-get` via a PPA or build from source

Quick Start
1) Export GeoJSON (optional — you already have `parcels.geojson`)
- `npm run export-geojson`

2) Build tiles
- Windows (PowerShell): `npm run build-tiles:win`
- macOS/Linux (bash): `npm run build-tiles`

This generates:
- `parcels.mbtiles`
- `tiles/` directory (Z/X/Y `.pbf` files)

3) Host the `tiles/` folder
- Upload `tiles/` to Object Storage (S3 / Cloudflare R2 / GCS / Supabase Storage)
- Put a CDN in front and make it public
- Important headers:
  - `.pbf` files: `Content-Type: application/x-protobuf`
  - If gzipped output: `Content-Encoding: gzip`
- Enable CORS for GET from your app origin

4) Configure the app
- Set tile URL in `.env`:
  - `VITE_PARCELS_PMTILES_URL=https://cdn.example.com/tiles/{z}/{x}/{y}.pbf`
- Restart dev server: `npm run dev`

5) Use the layer
- In the app, open the right "Layers" panel
- Toggle "Davis County Parcels"
- Zoom out (< 12) to see tiles
- Zoom in (≥ 14) to switch to live BBox from Supabase

Customization
- Change min/max zoom and layer name in scripts:
  - PowerShell: `scripts/build-tiles.ps1` args `-MinZoom`, `-MaxZoom`, `-Layer`
  - Bash: env vars `MINZ`, `MAXZ`, `LAYER`

Troubleshooting
- Black/empty tiles: ensure browser can fetch a sample tile (open a URL like `/12/1105/1693.pbf`).
- Wrong MIME: set `Content-Type: application/x-protobuf` for `.pbf` files.
- No tiles in-app: Confirm `.env` URL matches CDN path and restart Vite after edits.


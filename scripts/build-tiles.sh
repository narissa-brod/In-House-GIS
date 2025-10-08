#!/usr/bin/env bash
set -euo pipefail

GEOJSON=${1:-./parcels.geojson}
MBTILES=${2:-./parcels.mbtiles}
OUTDIR=${3:-./tiles}
MINZ=${MINZ:-6}
MAXZ=${MAXZ:-15}
LAYER=${LAYER:-parcels}

echo "Building vector tiles from $GEOJSON"
if [ ! -f "$GEOJSON" ]; then
  echo "GeoJSON not found: $GEOJSON" >&2
  exit 1
fi

command -v tippecanoe >/dev/null 2>&1 || { echo "tippecanoe not found in PATH" >&2; exit 1; }
command -v tile-join >/dev/null 2>&1 || { echo "tile-join not found in PATH" >&2; exit 1; }

echo "Step 1/2: tippecanoe -> $MBTILES"
tippecanoe \
  -o "$MBTILES" \
  --layer="$LAYER" \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --no-tile-compression \
  --generate-ids \
  --read-parallel \
  --force \
  --minimum-zoom="$MINZ" \
  --maximum-zoom="$MAXZ" \
  "$GEOJSON"

echo "Step 2/2: tile-join -> $OUTDIR"
rm -rf "$OUTDIR"
tile-join -e "$OUTDIR" "$MBTILES"

echo
echo "Success! Tiles written to $(realpath "$OUTDIR" 2>/dev/null || echo "$OUTDIR")"
echo "Upload this folder to your object storage (S3/R2/GCS/Supabase Storage) behind a CDN."
echo "Ensure headers: Content-Type: application/x-protobuf, Content-Encoding: gzip (if gzipped)."
echo "Then set VITE_PARCELS_PMTILES_URL=https://cdn.example.com/tiles/{z}/{x}/{y}.pbf in .env and restart vite."


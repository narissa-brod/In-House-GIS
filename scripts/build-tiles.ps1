Param(
  [string]$GeoJSON = "./parcels.geojson",
  [string]$Mbtiles = "./parcels.mbtiles",
  [string]$OutDir = "./tiles",
  [int]$MinZoom = 6,
  [int]$MaxZoom = 15,
  [string]$Layer = "parcels"
)

function Require-Cmd($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { Write-Error "'$name' not found in PATH. Install tippecanoe (and mapbox/tippecanoe's tile-join)."; exit 1 }
}

Write-Host "Building vector tiles from" $GeoJSON

if (-not (Test-Path $GeoJSON)) { Write-Error "GeoJSON not found: $GeoJSON"; exit 1 }

Require-Cmd tippecanoe
Require-Cmd tile-join

Write-Host "Step 1/2: tippecanoe ->" $Mbtiles
tippecanoe `
  -o $Mbtiles `
  --layer=$Layer `
  --drop-densest-as-needed `
  --extend-zooms-if-still-dropping `
  --no-tile-compression `
  --generate-ids `
  --read-parallel `
  --force `
  --minimum-zoom=$MinZoom `
  --maximum-zoom=$MaxZoom `
  $GeoJSON

if ($LASTEXITCODE -ne 0) { Write-Error "tippecanoe failed"; exit 1 }

Write-Host "Step 2/2: tile-join ->" $OutDir
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
tile-join -e $OutDir $Mbtiles
if ($LASTEXITCODE -ne 0) { Write-Error "tile-join failed"; exit 1 }

Write-Host "\nSuccess! Tiles written to" (Resolve-Path $OutDir)
Write-Host "Upload this folder to your object storage (S3/R2/GCS/Supabase Storage) behind a CDN."
Write-Host "Ensure headers: Content-Type: application/x-protobuf, Content-Encoding: gzip (if gzipped)."
Write-Host "Then set VITE_PARCELS_PMTILES_URL to https://cdn.example.com/tiles/{z}/{x}/{y}.pbf in .env and restart vite."


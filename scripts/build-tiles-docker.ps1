# Build vector tiles using tippecanoe via Docker
# Uses klokantech/tippecanoe image

Param(
  [string]$GeoJSON = "parcels.geojson",
  [string]$OutDir = "tiles",
  [int]$MinZoom = 10,
  [int]$MaxZoom = 16
)

Write-Host "=== Building Vector Tiles with Docker ===" -ForegroundColor Cyan
Write-Host ""

# Check if GeoJSON exists
if (-not (Test-Path $GeoJSON)) {
  Write-Error "GeoJSON file not found: $GeoJSON"
  Write-Host "Run 'npm run export-geojson' first"
  exit 1
}

$geojsonSize = (Get-Item $GeoJSON).Length / 1MB
Write-Host "Found $GeoJSON ($([math]::Round($geojsonSize, 2)) MB)" -ForegroundColor Green
Write-Host ""

# Get absolute paths
$currentDir = (Get-Location).Path

# Clean up old files
if (Test-Path $OutDir) {
  Remove-Item -Recurse -Force $OutDir
}
if (Test-Path "parcels.mbtiles") {
  Remove-Item "parcels.mbtiles"
}

Write-Host "Generating tiles (zoom $MinZoom to $MaxZoom)..." -ForegroundColor Cyan
Write-Host "This takes 5-10 minutes for 122k parcels..." -ForegroundColor Gray
Write-Host ""

# Run tippecanoe (removes --generate-ids which isn't supported)
docker run --rm `
  -v "${currentDir}:/data" `
  klokantech/tippecanoe:latest `
  tippecanoe `
  --output=/data/parcels.mbtiles `
  --force `
  --no-tile-compression `
  --drop-densest-as-needed `
  --extend-zooms-if-still-dropping `
  --minimum-zoom=$MinZoom `
  --maximum-zoom=$MaxZoom `
  --layer=parcels `
  --read-parallel `
  /data/$GeoJSON

if ($LASTEXITCODE -ne 0) {
  Write-Error "Tippecanoe failed"
  exit 1
}

Write-Host ""
Write-Host "Extracting tiles..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

docker run --rm `
  -v "${currentDir}:/data" `
  klokantech/tippecanoe:latest `
  tile-join `
  --force `
  --no-tile-compression `
  --output-to-directory=/data/$OutDir `
  /data/parcels.mbtiles

if ($LASTEXITCODE -ne 0) {
  Write-Error "tile-join failed"
  exit 1
}

if (Test-Path "parcels.mbtiles") {
  Remove-Item "parcels.mbtiles"
}

$tileCount = (Get-ChildItem -Path $OutDir -Recurse -Filter "*.pbf").Count

Write-Host ""
Write-Host "=== SUCCESS ===" -ForegroundColor Green
Write-Host "Generated $tileCount tiles in ./$OutDir" -ForegroundColor Green
Write-Host ""
Write-Host "Next: npm run upload-tiles" -ForegroundColor Cyan

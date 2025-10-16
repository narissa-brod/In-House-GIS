# Re-import Layton General Plan with proper property mapping

Write-Host "Re-importing Layton General Plan..." -ForegroundColor Cyan

# Download the GeoJSON from Supabase storage
Write-Host "Downloading Layton GP GeoJSON..." -ForegroundColor Yellow
$tempFile = Join-Path $env:TEMP "layton_gp.geojson"
Invoke-WebRequest -Uri "https://xgeeohpgsdkvuukuaosl.supabase.co/storage/v1/object/public/tiles/layton_general_plan_v1/layton_general_plan.geojson" -OutFile $tempFile

if (!(Test-Path $tempFile)) {
    Write-Host "Failed to download Layton GP" -ForegroundColor Red
    exit 1
}

Write-Host "Downloaded Layton GP to: $tempFile" -ForegroundColor Green

# Run the import script with LAYTON as the city override
Write-Host "Importing to database..." -ForegroundColor Yellow
npx tsx --env-file=.env scripts/import-general-plan.ts "$tempFile" LAYTON

Write-Host ""
Write-Host "Layton GP re-imported successfully!" -ForegroundColor Green
Write-Host "Now the normalization function will automatically categorize zones." -ForegroundColor Cyan
Write-Host "'Open Space/Public Facilities' is now in 'Parks & Recreation' category!" -ForegroundColor Green

#!/bin/bash
# Re-import Layton General Plan with proper property mapping

echo "🔄 Re-importing Layton General Plan..."

# Download the GeoJSON from Supabase storage
echo "📥 Downloading Layton GP GeoJSON..."
curl -o /tmp/layton_gp.geojson "https://xgeeohpgsdkvuukuaosl.supabase.co/storage/v1/object/public/tiles/layton_general_plan_v1/layton_general_plan.geojson"

if [ ! -f /tmp/layton_gp.geojson ]; then
  echo "❌ Failed to download Layton GP"
  exit 1
fi

echo "✅ Downloaded Layton GP"

# Run the import script with LAYTON as the city override
echo "📤 Importing to database..."
npx tsx --env-file=.env scripts/import-general-plan.ts /tmp/layton_gp.geojson LAYTON

echo "✅ Layton GP re-imported successfully!"
echo ""
echo "Now run migration 037 again to re-normalize all categories:"
echo "  Open Supabase SQL Editor"
echo "  Run: UPDATE public.general_plan SET normalized_category = normalize_gp_category(zone_name, zone_code, city, zone_type);"

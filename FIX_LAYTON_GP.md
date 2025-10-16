# Fix Layton General Plan Categorization

## Problem
All ~218 Layton GP zones are categorized as "Other" because the import script didn't extract the `General_Plan` property from the GeoJSON.

## Solution
Re-import Layton GP with updated import script that extracts the `General_Plan` property.

## Steps to Fix

### 1. Re-import Layton GP
Run this PowerShell command:
```powershell
cd c:\Dev\In-House-GIS
.\scripts\reimport-layton-gp.ps1
```

Or on Mac/Linux:
```bash
bash scripts/reimport-layton-gp.sh
```

This will:
- Download Layton GP GeoJSON from Supabase storage
- Delete existing Layton zones (city='LAYTON')
- Re-import with proper property mapping (General_Plan → zone_name)
- Automatically normalize categories using the updated function

### 2. Verify the Results
Run this query in Supabase SQL Editor:
```sql
SELECT zone_name, normalized_category, COUNT(*) as count
FROM general_plan
WHERE city = 'LAYTON'
GROUP BY zone_name, normalized_category
ORDER BY count DESC;
```

You should see:
- "Open Space/Public Facilities" → Parks & Recreation
- "Community Residential" → Residential Medium Density
- "Low Density Residential" → Residential Low Density
- And all other Layton zones properly categorized!

### 3. What Changed

#### Import Script ([import-general-plan.ts](scripts/import-general-plan.ts))
- Now extracts `General_Plan` property (Layton's zone name field)
- Supports `cityOverride` parameter to manually set city
- Usage: `npm run import-general-plan -- file.geojson LAYTON`

#### Normalization Function (Migration 037)
- Added "public.*facilities" pattern to Parks & Recreation category
- This catches "Open Space/Public Facilities" zones

## Expected Results After Fix

**Before:**
- Other: 375 zones (218 Layton + 157 others)
- Parks & Recreation: 51 zones

**After:**
- Other: ~0-20 zones (mostly overlay districts)
- Parks & Recreation: ~70+ zones (includes Layton Open Space)
- All Layton residential, commercial, and industrial zones properly categorized

## Layton Zone Mapping Reference
```
"Open Space/Public Facilities" → Parks & Recreation
"Low Density Residential" → Residential Low Density
"Neighborhood Residential" → Residential Low Density
"Community Residential" → Residential Medium Density
"Transitional Residential" → Residential Medium Density
"Condo/Apartment" → Residential High Density
"Condo/Townhouse" → Residential High Density
"Commercial" → Commercial
"Town Center" → Commercial
"Urban District" → Commercial
"Mixed Use" → Mixed Use
"Mixed Use Corridors" → Mixed Use
"Business Park/Mixed Use" → Mixed Use
"Industrial Flex" → Industrial
"Manufacturing" → Industrial
"Business/Research Park" → Industrial
"Business Park Expansion Area" → Industrial
"Professional Business" → Industrial
"School" → Education
"Insitutional Use" → Public/Institutional
"Agriculture" → Parks & Recreation (or could be separate)
```

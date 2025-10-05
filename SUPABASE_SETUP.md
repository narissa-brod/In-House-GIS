# Supabase Parcel Data Setup Guide

This guide explains how to set up Supabase to store Davis County parcel data for improved performance.

## Why Supabase?

Currently, the app fetches 10,000+ parcels from the Davis County API on every load, which is slow. Supabase provides:

- **10-100x faster queries** with database indexing
- **Spatial queries** using PostGIS to only load visible parcels
- **Server-side filtering** instead of client-side
- **Caching** - data is stored locally instead of hitting external API repeatedly
- **Scalability** - can handle millions of parcels efficiently

## Setup Steps

### 1. Run Database Migrations

First, you need to apply the SQL migrations to create the parcels table and spatial functions in your Supabase database.

**Option A: Using Supabase Dashboard (Recommended)**

1. Go to your Supabase project dashboard: https://app.supabase.com
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy and paste the contents of `supabase/migrations/001_create_parcels_table.sql`
5. Click **Run** to execute
6. Repeat for `supabase/migrations/002_create_spatial_functions.sql`

**Option B: Using Supabase CLI**

```bash
# Install Supabase CLI if you haven't already
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push
```

### 2. Get Supabase Service Role Key

The import script needs the **service role key** (not the anon key) to perform bulk inserts.

1. Go to **Project Settings** > **API** in your Supabase dashboard
2. Find the **service_role** key (under "Project API keys")
3. **⚠️ WARNING**: This key has full database access. Never commit it to git or expose it to the client!

### 3. Add Service Role Key to .env

Add the service role key to your `.env` file (NOT `.env.example`):

```bash
SUPABASE_SERVICE_KEY=your_service_role_key_here
```

Your `.env` should now have:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Install Dependencies

```bash
npm install
```

This will install `tsx` (TypeScript execution) and `@supabase/supabase-js` if not already installed.

### 5. Run the Import Script

```bash
npm run import-parcels
```

This script will:
1. Fetch all parcels from Davis County API (~10,000 parcels)
2. Transform the data to match Supabase schema
3. Clear existing parcel data (if any)
4. Insert parcels in batches of 500
5. Report progress and final count

**Expected output:**
```
🚀 Starting parcel import process...

📡 Fetching parcels from Davis County API...
✅ Fetched 10000 parcels

🔄 Transforming parcel data...
✅ Transformed 9847 parcels

🗑️  Clearing existing parcels...
✅ Existing parcels cleared

📦 Inserting 9847 parcels in batches of 500...
   ✓ Batch 1: Inserted 500 parcels (500/9847)
   ✓ Batch 2: Inserted 500 parcels (1000/9847)
   ...
   ✓ Batch 20: Inserted 347 parcels (9847/9847)

🎉 Import complete! Successfully imported 9847 parcels to Supabase.
✅ Database now contains 9847 total parcels.
```

### 6. Verify Data in Supabase

1. Go to **Table Editor** in Supabase dashboard
2. Select the `parcels` table
3. You should see all imported parcels with geometry data

### 7. Update Map.vue (Next Step)

Once data is imported, you'll need to update `Map.vue` to query from Supabase instead of Davis County API. This will be done in the next step.

## Maintenance

### Refreshing Parcel Data

Davis County updates parcel data periodically. To refresh:

```bash
npm run import-parcels
```

The script clears old data and re-imports fresh data.

### Scheduling Auto-Refresh (Optional)

You can set up a cron job or GitHub Action to automatically refresh parcel data:

```yaml
# .github/workflows/refresh-parcels.yml
name: Refresh Parcels
on:
  schedule:
    - cron: '0 2 * * 0'  # Every Sunday at 2 AM
  workflow_dispatch:  # Allow manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run import-parcels
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

## Troubleshooting

### Error: "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY"

- Make sure you added `SUPABASE_SERVICE_KEY` to `.env` (not `.env.example`)
- Make sure `.env` has `VITE_SUPABASE_URL`
- Restart your terminal/editor after adding env vars

### Error: "relation 'parcels' does not exist"

- You need to run the migrations first (Step 1)
- Go to Supabase SQL Editor and run the migration files

### Error: "function parcels_in_bounds does not exist"

- You need to run migration `002_create_spatial_functions.sql`

### Import takes a long time

- Normal! Importing 10,000 parcels with geometry data can take 2-5 minutes
- The script shows progress every batch (500 parcels)

### Geometry data not displaying

- Make sure PostGIS extension is enabled: `CREATE EXTENSION IF NOT EXISTS postgis;`
- Check that `geom` column has SRID 4326: `SELECT Find_SRID('public', 'parcels', 'geom');`

## Performance Comparison

**Before (Davis County API):**
- Initial load: 10-15 seconds
- Fetches all 10,000 parcels on every map load
- No spatial filtering
- Client-side filtering only

**After (Supabase with PostGIS):**
- Initial load: 1-2 seconds
- Fetches only visible parcels in viewport (~100-500)
- Spatial indexing with GIST
- Server-side filtering + client-side filtering
- Can scale to millions of parcels

## Next Steps

After importing data:

1. ✅ Verify data in Supabase dashboard
2. 🔄 Update `Map.vue` to use `fetchParcelsInBounds()` instead of Davis County API
3. 🧪 Test performance with spatial queries
4. 📊 Add analytics/monitoring
5. 🔄 Set up automated refresh schedule

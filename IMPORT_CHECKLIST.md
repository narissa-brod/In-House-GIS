# Supabase Import Checklist

Follow these steps in order to import Davis County parcel data into Supabase.

## ✅ Pre-Import Steps (In Supabase SQL Editor)

Go to your Supabase Dashboard → SQL Editor and run these files in order:

### Step 1: Check your current schema (optional)
📄 Run: `supabase/migrations/000_check_existing_schema.sql`

This shows you what columns your parcels table currently has.

### Step 2: Add missing columns
📄 Run: `supabase/migrations/001_alter_parcels_table.sql`

This adds:
- `owner_name`, `owner_address`, `owner_city`, `owner_state`, `owner_zip`
- `object_id`, `property_url`
- `geom` (geometry column for spatial data)
- Spatial indexes for performance

### Step 3: Create spatial query function
📄 Run: `supabase/migrations/002_create_spatial_functions.sql`

This creates the `parcels_in_bounds()` function for efficient map queries.

### Step 4: Clear existing data
📄 Run: `supabase/migrations/003_clear_parcels_data.sql`

This deletes all current rows in the parcels table (keeps the structure).

**⚠️ Warning**: This will delete all existing parcels data!

---

## 🔑 Get Service Role Key

1. Go to **Project Settings** → **API** in Supabase
2. Copy the **service_role** key (NOT the anon key)
3. Add to your `.env` file:

```bash
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**⚠️ Important**: Never commit this key to git!

---

## 📦 Install Dependencies

```bash
npm install
```

This installs `tsx` and `@supabase/supabase-js`.

---

## 🚀 Run Import Script

```bash
npm run import-parcels
```

Expected output:
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
   ...
🎉 Import complete! Successfully imported 9847 parcels to Supabase.
```

**Time**: 2-5 minutes depending on your connection.

---

## ✅ Verify Import

In Supabase Dashboard:

1. Go to **Table Editor**
2. Select `parcels` table
3. Check:
   - ✓ You see ~10,000 rows
   - ✓ `owner_name` column has data
   - ✓ `geom` column shows geometry data
   - ✓ `apn` column has parcel IDs

---

## 🔄 Next Steps

After successful import:

1. **Test the spatial query**:
   ```sql
   SELECT * FROM parcels_in_bounds('POLYGON((-112.1 40.9, -111.9 40.9, -111.9 41.1, -112.1 41.1, -112.1 40.9))');
   ```

2. **Update Map.vue** to use Supabase instead of Davis County API
   - Replace `fetchParcels()` with `fetchAllParcels()` from `src/lib/supabase.ts`

3. **Test performance** - should load 10-100x faster!

---

## 🐛 Troubleshooting

### "Missing SUPABASE_SERVICE_KEY"
- Add the service role key to `.env` file
- Restart your terminal

### "relation 'parcels' does not exist"
- Run migrations 001 and 002 first

### "function parcels_in_bounds does not exist"
- Run migration 002

### "column owner_name does not exist"
- Run migration 001 to add missing columns

### Import script hangs
- Normal! Can take 2-5 minutes
- Watch for progress messages every 500 parcels

---

## 📊 Expected Performance

**Before** (Davis County API):
- Load time: 10-15 seconds
- Fetches: All 10,000 parcels every time

**After** (Supabase):
- Load time: 1-2 seconds
- Fetches: Only visible parcels (~100-500)
- Scales to millions of parcels

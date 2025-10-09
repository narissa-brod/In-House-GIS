import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BUCKET_NAME = 'tiles';
const TILES_VERSION = 'parcels_v2'; // Increment this when you regenerate tiles
const TILES_DIR = './tiles';

async function uploadTiles() {
  console.log(`Uploading tiles from ${TILES_DIR} to Supabase Storage bucket '${BUCKET_NAME}'...\n`);

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);

  if (!bucketExists) {
    console.log(`Creating bucket '${BUCKET_NAME}'...`);
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 52428800, // 50MB
    });
    if (error) {
      console.error('Error creating bucket:', error);
      return;
    }
  }

  // Walk through tiles directory
  const files: string[] = [];
  function walkDir(dir: string) {
    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (item.endsWith('.pbf') || item.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  walkDir(TILES_DIR);
  console.log(`Found ${files.length} tile files to upload`);

  let uploaded = 0;
  let failed = 0;

  for (const filePath of files) {
    // Convert path to storage path: tiles/15/1234/5678.pbf -> parcels_v2/15/1234/5678.pbf
    const relativePath = filePath.replace(/\\/g, '/').replace(TILES_DIR + '/', '');
    const storagePath = `${TILES_VERSION}/${relativePath}`;

    try {
      const fileBuffer = readFileSync(filePath);

      const contentType = filePath.endsWith('.pbf')
        ? 'application/x-protobuf'
        : 'application/json';

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, fileBuffer, {
          contentType,
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.error(`❌ Failed to upload ${storagePath}:`, error.message);
        failed++;
      } else {
        uploaded++;
        if (uploaded % 100 === 0) {
          console.log(`   Uploaded ${uploaded}/${files.length} files...`);
        }
      }
    } catch (err) {
      console.error(`❌ Error uploading ${storagePath}:`, err);
      failed++;
    }
  }

  console.log(`\n✅ Upload complete!`);
  console.log(`   Uploaded: ${uploaded} files`);
  console.log(`   Failed: ${failed} files`);

  // Print the URL to use
  const tileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${TILES_VERSION}/{z}/{x}/{y}.pbf`;
  console.log(`\n📋 Update your .env file:`);
  console.log(`   VITE_PARCELS_TILES_URL=${tileUrl}`);
  console.log(`   VITE_PARCELS_TILES_MIN_ZOOM=10`);
  console.log(`   VITE_PARCELS_GEOJSON_MIN_ZOOM=99`);
}

uploadTiles();

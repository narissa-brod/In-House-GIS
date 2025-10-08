// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase credentials in .env file');
}

export const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON_KEY || '', {
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'Prefer': 'return=representation',
    },
  },
});

// Type definition for parcel row from Supabase
export interface ParcelRow {
  id: number;
  apn: string;
  object_id?: number;
  address?: string;
  city?: string;
  zip_code?: string;
  county?: string;
  owner_name?: string;
  owner_address?: string;
  owner_city?: string;
  owner_state?: string;
  owner_zip?: string;
  size_acres?: number;
  property_value?: number;
  subdivision?: string;
  year_built?: number;
  sqft?: number;
  property_url?: string;
  geom?: any; // PostGIS geometry (GeoJSON format)
  created_at?: string;
  updated_at?: string;
}

// Type definition for county row from Supabase
export interface CountyRow {
  id: number;
  name: string;
  fips_code?: string;
  area_sq_mi?: number;
  geom?: any; // PostGIS geometry (GeoJSON format)
  created_at?: string;
}

// Type for General Plan rows (minimal)
export interface GeneralPlanRow {
  id: number;
  zone_name?: string | null;
  zone_code?: string | null;
  zone_type?: string | null;
  name?: string | null;
  description?: string | null;
  county?: string | null;
  city?: string | null;
  year_adopted?: number | null;
  source?: string | null;
  geom?: any;
}

/**
 * Fetch parcels within map bounds
 * Uses PostGIS ST_Intersects to efficiently query only visible parcels
 */
export async function fetchParcelsInBounds(
  bounds: google.maps.LatLngBounds
): Promise<ParcelRow[]> {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  // Create a WKT polygon representing the bounding box
  const bbox = `POLYGON((${sw.lng()} ${sw.lat()}, ${ne.lng()} ${sw.lat()}, ${ne.lng()} ${ne.lat()}, ${sw.lng()} ${ne.lat()}, ${sw.lng()} ${sw.lat()}))`;

  // Use PostGIS spatial query to find parcels that intersect the bounding box
  const { data, error } = await supabase
    .rpc('parcels_in_bounds', {
      bbox_wkt: bbox
    });

  if (error) {
    console.error('Error fetching parcels:', error);
    throw error;
  }

  return data || [];
}

/**
 * Fetch all parcels (for initial load or when zoomed out)
 * Fetches in batches to overcome Supabase's 1000 row limit
 */
export async function fetchAllParcels(maxParcels: number = 10000): Promise<ParcelRow[]> {
  const BATCH_SIZE = 1000;
  const allParcels: ParcelRow[] = [];
  let start = 0;

  while (start < maxParcels) {
    const end = Math.min(start + BATCH_SIZE - 1, maxParcels - 1);

    const { data, error } = await supabase
      .from('parcels')
      .select('*')
      .range(start, end)
      .order('id', { ascending: true });

    if (error) {
      console.error('Error fetching parcels:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      break; // No more data
    }

    allParcels.push(...data);

    // If we got fewer than BATCH_SIZE rows, we've reached the end
    if (data.length < BATCH_SIZE) {
      break;
    }

    start += BATCH_SIZE;
  }

  console.log(`📦 Fetched ${allParcels.length} parcels total from Supabase`);
  return allParcels;
}

/**
 * Search parcels by APN, address, or owner name
 */
export async function searchParcels(query: string): Promise<ParcelRow[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*')
    .or(`apn.ilike.%${query}%,address.ilike.%${query}%,owner_name.ilike.%${query}%`)
    .limit(100);

  if (error) {
    console.error('Error searching parcels:', error);
    throw error;
  }

  return data || [];
}

/**
 * Fetch all county boundaries from Supabase
 */
export async function fetchCounties(): Promise<CountyRow[]> {
  const { data, error } = await supabase
    .from('counties')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching counties:', error);
    throw error;
  }

  return data || [];
}

/**
 * Fetch General Plan polygons within map bounds.
 * Returns GeoJSON-like features for easy consumption by deck.gl GeoJsonLayer.
 */
export async function fetchGeneralPlanInBounds(
  bounds: google.maps.LatLngBounds
): Promise<Array<{ type: 'Feature'; geometry: any; properties: any }>> {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const bbox = `POLYGON((${sw.lng()} ${sw.lat()}, ${ne.lng()} ${sw.lat()}, ${ne.lng()} ${ne.lat()}, ${sw.lng()} ${ne.lat()}, ${sw.lng()} ${sw.lat()}))`;

  const { data, error } = await supabase.rpc('general_plan_in_bounds', {
    bbox_wkt: bbox
  });

  if (error) {
    console.error('Error fetching general plan:', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
    type: 'Feature',
    geometry: typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom,
    properties: {
      id: row.id,
      zone_name: row.zone_name,
      zone_code: row.zone_code,
      zone_type: row.zone_type,
      name: row.name,
      description: row.description,
      county: row.county,
      city: row.city,
      year_adopted: row.year_adopted,
      source: row.source
    }
  }));
}

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

// Type for Layton overlay features
export interface LaytonOverlayRow {
  id: number;
  layer_name: string;
  layer_title: string;
  layer_description?: string;
  layer_color?: string;
  properties?: Record<string, any>;
  geom?: any; // PostGIS geometry (GeoJSON format)
  source?: string;
  source_url?: string;
  feature_index?: number;
  created_at?: string;
  updated_at?: string;
}

// Available Layton overlay layers
export const LAYTON_OVERLAY_LAYERS = [
  {
    name: 'debris_hazards',
    title: 'Geology - Debris Hazards',
    description: 'Debris flow and hazard zones',
    color: '#ffa500', // Orange
    defaultVisible: false
  },
  {
    name: 'faults',
    title: 'Geology - Faults',
    description: 'Known geological fault lines',
    color: '#8b00ff', // Purple
    defaultVisible: false
  },
  {
    name: 'development_agreements',
    title: 'Development Agreements',
    description: 'Active development agreement areas',
    color: '#4169e1', // Royal Blue
    defaultVisible: false
  }
] as const;

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

/**
 * Fetch Layton overlay features within map bounds
 * Optionally filter by layer name
 */
export async function fetchLaytonOverlays(
  bounds: google.maps.LatLngBounds,
  layerName?: string
): Promise<Array<{ type: 'Feature'; geometry: any; properties: any }>> {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const bbox = `POLYGON((${sw.lng()} ${sw.lat()}, ${ne.lng()} ${sw.lat()}, ${ne.lng()} ${ne.lat()}, ${sw.lng()} ${ne.lat()}, ${sw.lng()} ${sw.lat()}))`;

  const { data, error } = await supabase.rpc('layton_overlays_in_bounds', {
    bbox_wkt: bbox,
    layer_filter: layerName || null
  });

  if (error) {
    console.error('Error fetching Layton overlays:', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
    type: 'Feature',
    geometry: typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom,
    properties: {
      id: row.id,
      layer_name: row.layer_name,
      layer_title: row.layer_title,
      layer_color: row.layer_color,
      ...(row.properties || {})
    }
  }));
}

/**
 * Fetch all features for a specific Layton overlay layer
 * Useful for initial load or when you need all features regardless of viewport
 */
export async function fetchLaytonOverlayByName(
  layerName: string
): Promise<Array<{ type: 'Feature'; geometry: any; properties: any }>> {
  const { data, error } = await supabase
    .from('layton_overlays')
    .select('*')
    .eq('layer_name', layerName)
    .order('feature_index', { ascending: true });

  if (error) {
    console.error(`Error fetching Layton overlay layer '${layerName}':`, error);
    throw error;
  }

  return (data || []).map((row: LaytonOverlayRow) => ({
    type: 'Feature',
    geometry: typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom,
    properties: {
      id: row.id,
      layer_name: row.layer_name,
      layer_title: row.layer_title,
      layer_color: row.layer_color,
      ...(row.properties || {})
    }
  }));
}

/**
 * Get statistics about available overlay layers
 */
export async function getLaytonOverlayStats(): Promise<Array<{
  layer_name: string;
  layer_title: string;
  layer_color: string;
  feature_count: number;
}>> {
  const { data, error } = await supabase
    .from('layton_overlays')
    .select('layer_name, layer_title, layer_color')
    .order('layer_name');

  if (error) {
    console.error('Error fetching overlay stats:', error);
    return [];
  }

  // Group by layer and count features
  const layerMap = new Map<string, { title: string; color: string; count: number }>();

  for (const row of data || []) {
    const existing = layerMap.get(row.layer_name);
    if (existing) {
      existing.count++;
    } else {
      layerMap.set(row.layer_name, {
        title: row.layer_title,
        color: row.layer_color || '#999',
        count: 1
      });
    }
  }

  return Array.from(layerMap.entries()).map(([name, info]) => ({
    layer_name: name,
    layer_title: info.title,
    layer_color: info.color,
    feature_count: info.count
  }));
}

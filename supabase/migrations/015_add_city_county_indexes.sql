-- Speed up search_parcels by supporting equality filters on county and city
CREATE INDEX IF NOT EXISTS parcels_county_idx ON public.parcels (county);
CREATE INDEX IF NOT EXISTS parcels_city_idx ON public.parcels (city);

-- Optional composite to accelerate common query pattern (county + prop_class)
-- This keeps bloat low while helping the most frequent scans
CREATE INDEX IF NOT EXISTS parcels_county_prop_class_idx ON public.parcels (county, prop_class);

-- Composite index to support common UI pattern: county + city + class + acreage range
-- Postgres can use the leftmost prefix for queries missing some terms
CREATE INDEX IF NOT EXISTS parcels_county_city_class_acres_idx
ON public.parcels (county, city, prop_class, parcel_acres);

-- Smaller partial index for Davis-only traffic (most frequent)
CREATE INDEX IF NOT EXISTS parcels_davis_class_acres_partial_idx
ON public.parcels (prop_class, parcel_acres)
WHERE county = 'Davis' AND prop_class IS NOT NULL AND parcel_acres IS NOT NULL;

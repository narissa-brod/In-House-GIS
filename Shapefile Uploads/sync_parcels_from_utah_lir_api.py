"""
Sync Davis County Parcels from Utah AGRC LIR API to Supabase
Fetches latest parcel data with Land Information Records (LIR)
including property classification, building details, and market values
"""

import requests
import json
import os
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm
import time

# Load environment variables
load_dotenv('../.env')

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
# Try to use service role key first (has full permissions), fallback to anon key
# Support multiple env var names for service role key
SUPABASE_KEY = (
    os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or
    os.getenv("SUPABASE_SERVICE_KEY") or
    os.getenv("VITE_SUPABASE_ANON_KEY")
)

if not SUPABASE_KEY:
    raise ValueError("Missing Supabase key! Set VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in .env")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Utah AGRC ArcGIS REST API endpoints
# Using LIR (Land Information Records) which includes property classification and building data
DAVIS_PARCELS_LIR_URL = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis_LIR/FeatureServer/0"

def get_parcel_count():
    """Get total count of parcels in the LIR API"""
    url = f"{DAVIS_PARCELS_LIR_URL}/query"
    params = {
        'where': '1=1',
        'returnCountOnly': 'true',
        'f': 'json'
    }
    response = requests.get(url, params=params)
    data = response.json()
    return data.get('count', 0)

def fetch_parcels_batch(offset=0, batch_size=1000):
    """
    Fetch a batch of parcels from Utah LIR API

    Args:
        offset: Starting record number
        batch_size: Number of records to fetch

    Returns:
        List of parcel features
    """
    url = f"{DAVIS_PARCELS_LIR_URL}/query"

    # Query parameters - request all fields and geometry
    params = {
        'where': '1=1',
        'outFields': '*',
        'returnGeometry': 'true',
        'outSR': '4326',  # WGS84
        'f': 'geojson',
        'resultOffset': offset,
        'resultRecordCount': batch_size
    }

    try:
        response = requests.get(url, params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        return data.get('features', [])
    except Exception as e:
        print(f"Error fetching batch at offset {offset}: {e}")
        return []

def safe_float(value):
    """Safely convert value to float, handling None and empty strings"""
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None

def safe_int(value):
    """Safely convert value to int, handling None and empty strings"""
    if value is None or value == '':
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def safe_str(value):
    """Safely convert value to string, handling None"""
    if value is None or value == '':
        return None
    return str(value)

def transform_parcel_to_supabase(feature):
    """
    Transform ArcGIS LIR feature to Supabase parcel record

    Args:
        feature: GeoJSON feature from Utah LIR API

    Returns:
        Dictionary ready for Supabase insert
    """
    props = feature.get('properties', {})
    geom = feature.get('geometry')

    # Convert Polygon to MultiPolygon if needed (Supabase table expects MultiPolygon)
    if geom and geom.get('type') == 'Polygon':
        geom = {
            'type': 'MultiPolygon',
            'coordinates': [geom['coordinates']]
        }

    # Extract basic parcel fields
    parcel_id = props.get('PARCEL_ID') or props.get('PARCELID') or props.get('APN')

    # Build record with all LIR fields
    record = {
        # Basic identifiers
        'apn': parcel_id,
        'address': safe_str(props.get('PARCEL_ADD')),
        'city': safe_str(props.get('PARCEL_CITY')),
        'zip_code': safe_str(props.get('PARCEL_ZIP')),
        'county': 'Davis',

        # Owner information (from basic API)
        'owner_type': safe_str(props.get('OWN_TYPE')),

        # Property classification (NEW from LIR)
        'prop_class': safe_str(props.get('PROP_CLASS')),  # Vacant, Residential, Commercial, etc.
        'taxexempt_type': safe_str(props.get('TAXEXEMPT_TYPE')),
        'primary_res': safe_str(props.get('PRIMARY_RES')),

        # Building details (NEW from LIR)
        'bldg_sqft': safe_float(props.get('BLDG_SQFT')),
        'bldg_sqft_info': safe_str(props.get('BLDG_SQFT_INFO')),
        'floors_cnt': safe_float(props.get('FLOORS_CNT')),
        'floors_info': safe_str(props.get('FLOORS_INFO')),
        'built_yr': safe_int(props.get('BUILT_YR')),
        'effbuilt_yr': safe_int(props.get('EFFBUILT_YR')),
        'const_material': safe_str(props.get('CONST_MATERIAL')),

        # Market values (NEW from LIR)
        'total_mkt_value': safe_float(props.get('TOTAL_MKT_VALUE')),
        'land_mkt_value': safe_float(props.get('LAND_MKT_VALUE')),

        # Acreage and units (NEW from LIR)
        'parcel_acres': safe_float(props.get('PARCEL_ACRES')),
        'house_cnt': safe_str(props.get('HOUSE_CNT')),

        # Additional details
        'subdiv_name': safe_str(props.get('SUBDIV_NAME')),
        'tax_dist': safe_str(props.get('TAX_DIST')),

        # Note: subdivision, property_value, year_built, sqft, size_acres exist in original schema
        # but are not accessible via Supabase PostgREST API (schema cache issue)
        # Using new LIR equivalents: subdiv_name, total_mkt_value, built_yr, bldg_sqft, parcel_acres

        # URLs and contact
        'recorder_phone': '1-801-451-3225',  # Davis County Recorder
        'property_url': safe_str(props.get('CoParcel_URL')) or 'https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map',

        # Geometry
        'geom': geom  # GeoJSON geometry
    }

    return record

def clear_existing_parcels():
    """
    Clear all existing parcels from Supabase
    Uses the truncate function if available, otherwise falls back to delete
    """
    try:
        print("Clearing existing parcels from database...")

        # Try using the truncate function (much faster than DELETE)
        try:
            result = supabase.rpc('truncate_parcels').execute()
            print(f"✓ Cleared all existing records using TRUNCATE")
            return True
        except Exception as truncate_error:
            # If truncate function doesn't exist, use DELETE
            if 'could not find' in str(truncate_error).lower():
                print("⚠ TRUNCATE function not found, using DELETE (may be slow)...")
                print("  To speed this up, run migration 004_create_truncate_function.sql")
                result = supabase.table('parcels').delete().neq('id', 0).execute()
                print(f"✓ Cleared existing records using DELETE")
                return True
            else:
                raise truncate_error
    except Exception as e:
        print(f"✗ Error clearing parcels: {e}")
        print("\nTip: For large datasets, you can:")
        print("  1. Run the sync without --clear to append data")
        print("  2. Manually truncate in Supabase SQL Editor: TRUNCATE TABLE parcels CASCADE;")
        return False

def upload_batch(records):
    """Upload a batch of records to Supabase"""
    if not records:
        return 0

    success_count = 0
    for record in records:
        try:
            supabase.table('parcels').insert(record).execute()
            success_count += 1
        except Exception as e:
            # Skip duplicates or errors
            if 'duplicate key' not in str(e).lower():
                print(f"Error inserting parcel {record.get('apn')}: {e}")

    return success_count

def sync_parcels(limit=None, clear_first=False):
    """
    Sync parcels from Utah LIR API to Supabase

    Args:
        limit: Maximum number of parcels to sync (None for all)
        clear_first: Whether to clear existing data before syncing
    """
    print("=" * 60)
    print("Davis County Parcel Sync - Utah AGRC LIR API to Supabase")
    print("LIR = Land Information Records (includes vacancy & building data)")
    print("=" * 60)

    # Check which key is being used
    if os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY"):
        print("✓ Using SERVICE ROLE key (full permissions)")
    else:
        print("⚠ Using ANON key (may have RLS restrictions)")
        print("  Add SUPABASE_SERVICE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY to .env for full access")
    print()

    # Get total count
    total_count = get_parcel_count()
    print(f"Total parcels available in Utah LIR API: {total_count:,}")

    if limit:
        print(f"Limiting sync to first {limit:,} parcels")
        total_count = min(total_count, limit)

    # Clear existing data if requested
    if clear_first:
        if not clear_existing_parcels():
            print("Failed to clear existing data. Aborting.")
            return

    # Fetch and upload in batches
    batch_size = 1000
    offset = 0
    total_uploaded = 0

    with tqdm(total=total_count, desc="Syncing parcels") as pbar:
        while offset < total_count:
            # Fetch batch
            features = fetch_parcels_batch(offset, batch_size)

            if not features:
                print(f"\nNo more features returned at offset {offset}")
                break

            # Transform to Supabase format
            records = []
            for feature in features:
                try:
                    record = transform_parcel_to_supabase(feature)
                    if record.get('apn'):  # Only include if has APN
                        records.append(record)
                except Exception as e:
                    print(f"\nError transforming feature: {e}")

            # Upload batch
            uploaded = upload_batch(records)
            total_uploaded += uploaded

            pbar.update(len(features))
            offset += batch_size

            # Rate limiting - be nice to the API
            time.sleep(0.5)

    print("\n" + "=" * 60)
    print(f"Sync complete!")
    print(f"  Total processed: {offset:,}")
    print(f"  Successfully uploaded: {total_uploaded:,}")
    print("=" * 60)
    print("\nNew LIR fields now available:")
    print("  - prop_class: Vacant, Residential, Commercial, etc.")
    print("  - bldg_sqft: Building square footage")
    print("  - built_yr: Year built")
    print("  - total_mkt_value: Total market value")
    print("  - land_mkt_value: Land value")
    print("  - parcel_acres: Parcel size")

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Sync Davis County parcels from Utah LIR API')
    parser.add_argument('--limit', type=int, help='Limit number of parcels to sync')
    parser.add_argument('--clear', action='store_true', help='Clear existing parcels before sync')
    args = parser.parse_args()

    sync_parcels(limit=args.limit, clear_first=args.clear)

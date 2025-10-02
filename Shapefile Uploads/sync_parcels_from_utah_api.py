"""
Sync Davis County Parcels from Utah AGRC API to Supabase
Fetches latest parcel data from Utah's official ArcGIS REST API
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
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Utah AGRC ArcGIS REST API endpoints
DAVIS_PARCELS_URL = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis/FeatureServer/0"

def get_parcel_count():
    """Get total count of parcels in the API"""
    url = f"{DAVIS_PARCELS_URL}/query"
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
    Fetch a batch of parcels from Utah API

    Args:
        offset: Starting record number
        batch_size: Number of records to fetch

    Returns:
        List of parcel features
    """
    url = f"{DAVIS_PARCELS_URL}/query"

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

def transform_parcel_to_supabase(feature):
    """
    Transform ArcGIS feature to Supabase parcel record

    Args:
        feature: GeoJSON feature from Utah API

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

    # Extract relevant fields (adjust based on actual API field names)
    record = {
        'apn': props.get('PARCEL_ID') or props.get('PARCELID') or props.get('APN'),
        'address': props.get('SITEADDR') or props.get('ADDRESS') or props.get('PARCEL_ADD'),
        'city': props.get('CITY') or props.get('PARCEL_CIT'),
        'zip_code': props.get('ZIP') or props.get('ZIPCODE') or props.get('PARCEL_ZIP'),
        'county': 'Davis',
        'fips': str(props.get('FIPS')) if props.get('FIPS') else '49011',
        'owner_type': props.get('OWN_TYPE') or props.get('OWNER_TYPE') or 'Unknown',
        'size_acres': float(props.get('ACRES') or props.get('PARCEL_ACRES') or 0) if props.get('ACRES') or props.get('PARCEL_ACRES') else None,
        'recorder_phone': '1-801-451-3225',  # Davis County Recorder
        'property_url': 'https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map',
        'geom': geom  # GeoJSON geometry
    }

    return record

def clear_existing_parcels():
    """Clear all existing parcels from Supabase"""
    try:
        print("Clearing existing parcels from database...")
        result = supabase.table('parcels').delete().neq('id', 0).execute()
        print(f"Cleared existing records")
        return True
    except Exception as e:
        print(f"Error clearing parcels: {e}")
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
    Sync parcels from Utah API to Supabase

    Args:
        limit: Maximum number of parcels to sync (None for all)
        clear_first: Whether to clear existing data before syncing
    """
    print("=" * 60)
    print("Davis County Parcel Sync - Utah AGRC API to Supabase")
    print("=" * 60)

    # Get total count
    total_count = get_parcel_count()
    print(f"Total parcels available in Utah API: {total_count:,}")

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

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Sync Davis County parcels from Utah API to Supabase')
    parser.add_argument('--limit', type=int, help='Limit number of parcels to sync (for testing)')
    parser.add_argument('--clear', action='store_true', help='Clear existing parcels before syncing')

    args = parser.parse_args()

    # Run sync
    sync_parcels(limit=args.limit, clear_first=args.clear)

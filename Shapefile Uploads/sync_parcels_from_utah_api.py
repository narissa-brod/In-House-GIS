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
# Try to use service role key first (has full permissions), fallback to anon key
SUPABASE_KEY = (
    os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or
    os.getenv("SUPABASE_SERVICE_KEY") or
    os.getenv("VITE_SUPABASE_ANON_KEY")
)

if not SUPABASE_KEY:
    raise ValueError("Missing Supabase key! Set SUPABASE_SERVICE_KEY in .env")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Davis County GIS Portal API - has owner information!
DAVIS_PARCELS_URL = "https://gisportal-pro.daviscountyutah.gov/server/rest/services/Operational/Parcels/MapServer/0"

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

    # Extract fields from Davis County GIS API
    # Build full address from components
    full_address = props.get('ParcelFullSitusAddress') or props.get('ParcelSitusSuffix') or None

    # Build mailing address
    mail_line1 = props.get('ParcelOwnerMailAddressLine1')
    mail_line2 = props.get('ParcelOwnerMailAddressLine2')
    mail_line3 = props.get('ParcelOwnerMailAddressLine3')
    owner_address_parts = [p for p in [mail_line1, mail_line2, mail_line3] if p]
    owner_address = ', '.join(owner_address_parts) if owner_address_parts else None

    record = {
        'apn': props.get('ParcelTaxID'),  # Fixed: it's ParcelTaxID not ParcelID!
        'address': full_address,
        'city': props.get('ParcelSitusCity'),
        'zip_code': props.get('ParcelSitusZipcode'),
        'county': 'Davis',

        # Owner information (NEW - from Davis County API!)
        'owner_name': props.get('ParcelOwnerName'),
        'owner_address': owner_address,
        'owner_city': props.get('ParcelOwnerMailCity'),
        'owner_state': props.get('ParcelOwnerMailState'),
        'owner_zip': props.get('ParcelOwnerMailZipcode'),

        # Size and other fields
        'size_acres': float(props.get('ParcelAcreage') or 0) if props.get('ParcelAcreage') else None,
        'recorder_phone': '1-801-451-3225',
        'property_url': 'https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map',
        'geom': geom
    }

    return record

def clear_existing_parcels():
    """Clear all existing parcels from Supabase using TRUNCATE"""
    try:
        print("Clearing existing parcels from database...")
        # Use TRUNCATE for speed
        result = supabase.rpc('truncate_parcels').execute()
        print(f"✓ Cleared all existing records using TRUNCATE")
        return True
    except Exception as e:
        print(f"✗ Error clearing parcels: {e}")
        return False

def upload_batch(records):
    """Upload a batch of records to Supabase - much faster than one at a time!"""
    if not records:
        return 0

    try:
        # Use UPSERT to handle duplicates gracefully (update if exists, insert if not)
        supabase.table('parcels').upsert(records, on_conflict='apn').execute()
        return len(records)
    except Exception as e:
        error_msg = str(e).lower()

        # Print actual error for debugging
        print(f"\n⚠ Batch insert failed: {e}")

        # Check if it's a schema/field issue
        if 'could not find' in error_msg or 'column' in error_msg:
            print(f"✗ Schema error - check that all fields exist in parcels table")
            print(f"   Trying to insert fields: {list(records[0].keys()) if records else 'none'}")
            return 0

        # Fall back to one-by-one upsert for any error
        print(f"   Falling back to one-by-one upsert (slower)...")
        success_count = 0
        for record in records:
            try:
                supabase.table('parcels').upsert(record, on_conflict='apn').execute()
                success_count += 1
            except Exception as e2:
                print(f"Error upserting parcel {record.get('apn')}: {e2}")
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
            seen_apns = set()
            for feature in features:
                try:
                    record = transform_parcel_to_supabase(feature)
                    apn = record.get('apn')
                    # Only include if has APN and not a duplicate within this batch
                    if apn and apn not in seen_apns:
                        records.append(record)
                        seen_apns.add(apn)
                    elif apn and apn in seen_apns:
                        # Skip duplicate within batch
                        pass
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

"""
Parcel Shapefile to Supabase Uploader
Reads a parcel shapefile and uploads it to Supabase PostGIS database
"""

import geopandas as gpd
from supabase import create_client
from shapely.geometry import mapping
import json
from tqdm import tqdm
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY")  # or use service_role key for better permissions

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def clean_value(value):
    """Clean None/NaN values for JSON serialization"""
    if value is None or (isinstance(value, float) and str(value) == 'nan'):
        return None
    return value

def upload_parcels(shapefile_path, batch_size=100, limit=None):
    """
    Upload parcels from shapefile to Supabase

    Args:
        shapefile_path: Path to the .shp file
        batch_size: Number of records to upload at once
        limit: Maximum number of parcels to upload (None for all)
    """
    print(f"Reading shapefile: {shapefile_path}")
    
    # Read shapefile
    gdf = gpd.read_file(shapefile_path)

    # Limit to subset if specified
    if limit:
        print(f"Limiting to first {limit} parcels for testing...")
        gdf = gdf.head(limit)

    # Calculate acreage from geometry
    print("Calculating acreage from geometry...")
    gdf_utm = gdf.to_crs(epsg=26912)  # UTM Zone 12N for Utah
    gdf['calculated_acres'] = gdf_utm.geometry.area / 4046.86  # Convert sq meters to acres

    # Reproject to WGS84 (EPSG:4326) if needed
    if gdf.crs.to_epsg() != 4326:
        print(f"Reprojecting from {gdf.crs} to EPSG:4326...")
        gdf = gdf.to_crs(epsg=4326)

    print(f"Total parcels to upload: {len(gdf)}")
    print(f"Columns in shapefile: {list(gdf.columns)}")
    
    # Show user the actual column names
    print("\nAvailable columns:")
    for i, col in enumerate(gdf.columns):
        print(f"  {i}: {col}")

    # Prepare records for upload
    records = []
    failed = 0

    for idx, row in tqdm(gdf.iterrows(), total=len(gdf), desc="Processing parcels"):
        try:
            # Extract Davis County specific fields
            apn = clean_value(row.get('PARCEL_ID'))
            address = clean_value(row.get('PARCEL_ADD'))
            city = clean_value(row.get('PARCEL_CIT'))
            zip_code = clean_value(row.get('PARCEL_ZIP'))
            fips = clean_value(row.get('FIPS'))
            owner_type = clean_value(row.get('OWN_TYPE'))
            recorder_phone = clean_value(row.get('RECORDER'))
            property_url = clean_value(row.get('CoParcel_U'))
            size_acres = row.get('calculated_acres')

            # Convert to strings where needed
            if apn: apn = str(apn)
            if address: address = str(address)
            if city: city = str(city)
            if zip_code: zip_code = str(zip_code)
            if fips: fips = str(fips)
            if owner_type: owner_type = str(owner_type)
            if recorder_phone: recorder_phone = str(recorder_phone)
            if property_url: property_url = str(property_url)
            if size_acres: size_acres = float(size_acres)
            
            # Get geometry as GeoJSON
            geom = row.geometry
            if geom is None or geom.is_empty:
                failed += 1
                continue
            
            # Convert to MultiPolygon if it's a Polygon
            if geom.geom_type == 'Polygon':
                from shapely.geometry import MultiPolygon
                geom = MultiPolygon([geom])
            
            # Convert to GeoJSON string for PostGIS
            geojson = json.dumps(mapping(geom))

            record = {
                'apn': apn,
                'address': address,
                'city': city,
                'zip_code': zip_code,
                'county': 'Davis',
                'fips': fips,
                'owner_type': owner_type,
                'size_acres': size_acres,
                'recorder_phone': recorder_phone,
                'property_url': property_url,
                'geom': f'SRID=4326;{geom.wkt}'  # PostGIS format
            }
            
            records.append(record)
            
            # Upload in batches
            if len(records) >= batch_size:
                upload_batch(records)
                records = []
                
        except Exception as e:
            print(f"\nError processing record {idx}: {e}")
            failed += 1
            continue
    
    # Upload remaining records
    if records:
        upload_batch(records)
    
    print(f"\nUpload complete!")
    print(f"  Successfully uploaded: {len(gdf) - failed}")
    print(f"  Failed: {failed}")

def upload_batch(records):
    """Upload a batch of records to Supabase"""
    try:
        # Use raw SQL for PostGIS geometry insertion
        for record in records:
            supabase.table('parcels').insert(record).execute()
    except Exception as e:
        print(f"\nBatch upload error: {e}")
        print("Trying individual inserts...")
        for record in records:
            try:
                supabase.table('parcels').insert(record).execute()
            except Exception as e2:
                print(f"Failed to insert record: {e2}")

def test_connection():
    """Test Supabase connection"""
    try:
        result = supabase.table('parcels').select("id").limit(1).execute()
        print("Supabase connection successful!")
        return True
    except Exception as e:
        print(f"Supabase connection failed: {e}")
        return False

if __name__ == "__main__":
    # Test connection first
    if not test_connection():
        print("\nPlease check your Supabase credentials in .env file")
        exit(1)
    
    # Path to your shapefile
    shapefile_path = input("Enter path to your parcel shapefile (.shp): ").strip('"')
    
    if not os.path.exists(shapefile_path):
        print(f"Error: File not found: {shapefile_path}")
        exit(1)
    
    # Upload parcels (limit to 500 for testing)
    upload_parcels(shapefile_path, batch_size=50, limit=500)
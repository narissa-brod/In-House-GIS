"""
Test script to explore Utah LIR (Land Information Records) API
Check what fields are available for owner name and mailing address
"""

import requests
import json

# Utah LIR API endpoint
LIR_URL = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Davis_LIR/FeatureServer/0"

def get_service_info():
    """Get service metadata to see available fields"""
    url = f"{LIR_URL}"
    params = {'f': 'json'}

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        print("=" * 60)
        print("Available Fields in Davis County LIR API:")
        print("=" * 60)

        if 'fields' in data:
            for field in data['fields']:
                name = field.get('name', 'Unknown')
                alias = field.get('alias', '')
                field_type = field.get('type', '')
                print(f"{name:30} | {alias:30} | {field_type}")

        return data
    except Exception as e:
        print(f"Error fetching service info: {e}")
        return None

def get_sample_records(count=3):
    """Fetch a few sample records to see actual data"""
    url = f"{LIR_URL}/query"

    params = {
        'where': '1=1',
        'outFields': '*',
        'returnGeometry': 'false',
        'f': 'json',
        'resultRecordCount': count
    }

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        print("\n" + "=" * 60)
        print(f"Sample Records (first {count}):")
        print("=" * 60)

        if 'features' in data:
            for i, feature in enumerate(data['features'], 1):
                props = feature.get('attributes', {})
                print(f"\nRecord {i}:")
                print(json.dumps(props, indent=2))

        return data
    except Exception as e:
        print(f"Error fetching sample records: {e}")
        return None

if __name__ == "__main__":
    print("Fetching Davis County LIR API information...\n")

    # Get field list
    service_info = get_service_info()

    # Get sample records
    sample_data = get_sample_records(3)

import geopandas as gpd
import pandas as pd

# Read the shapefile
gdf = gpd.read_file('C:/Dev/Parcel-Data/Parcels_Davis.shp')

# Show first 5 rows with all columns
print('=== SAMPLE DATA (first 5 rows) ===')
pd.set_option('display.max_columns', None)
pd.set_option('display.width', None)
print(gdf.head(5))

print('\n=== COLUMN INFO ===')
for col in gdf.columns:
    if col != 'geometry':
        non_null = gdf[col].notna().sum()
        total = len(gdf)
        sample = gdf[col].dropna().head(3).tolist()
        print(f'{col}: {non_null}/{total} filled | Sample: {sample}')

# Calculate acreage from geometry
print('\n=== GEOMETRY INFO ===')
gdf_wgs84 = gdf.to_crs(epsg=4326)
gdf_utm = gdf_wgs84.to_crs(epsg=26912)  # UTM Zone 12N for Utah
gdf_utm['calculated_acres'] = gdf_utm.geometry.area / 4046.86  # Convert sq meters to acres
print(f'Sample calculated acreages: {gdf_utm["calculated_acres"].head(5).tolist()}')

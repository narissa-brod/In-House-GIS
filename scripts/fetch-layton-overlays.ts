/**
 * Fetch Layton City overlay layers from ArcGIS REST API and save as GeoJSON
 *
 * Usage: npx tsx scripts/fetch-layton-overlays.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface ArcGISFeature {
  geometry: any;
  attributes: Record<string, any>;
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  fields?: any[];
  geometryType?: string;
  spatialReference?: any;
}

// Layton City overlay layers to fetch
const LAYERS = [
  {
    name: 'slope_failure',
    title: 'Geology - Slope Failure',
    url: 'https://www.laytoncity.org/arcgis109/rest/services/Geology/Slope_Failure/MapServer/0/query',
    color: '#ff6b6b', // Red
    description: 'Areas susceptible to slope failure and landslides'
  },
  {
    name: 'debris_hazards',
    title: 'Geology - Debris Hazards',
    url: 'https://www.laytoncity.org/arcgis109/rest/services/Geology/Debris_Hazards/MapServer/0/query',
    color: '#ffa500', // Orange
    description: 'Debris flow and hazard zones'
  },
  {
    name: 'faults',
    title: 'Geology - Faults',
    url: 'https://www.laytoncity.org/arcgis109/rest/services/Geology/Faults/MapServer/0/query',
    color: '#8b00ff', // Purple
    description: 'Known geological fault lines'
  },
  {
    name: 'development_agreements',
    title: 'Development Agreements',
    url: 'https://www.laytoncity.org/arcgis109/rest/services/CommunityDevelopment/Development_Agreements/MapServer/0/query',
    color: '#4169e1', // Royal Blue
    description: 'Active development agreement areas'
  }
];

/**
 * Convert ArcGIS geometry to GeoJSON geometry
 */
function arcgisToGeoJSON(arcgisGeom: any, geometryType: string): any {
  if (!arcgisGeom) return null;

  // Handle different ArcGIS geometry types
  switch (geometryType) {
    case 'esriGeometryPolygon':
      // ArcGIS polygon: { rings: [[[x,y], [x,y], ...]] }
      return {
        type: 'Polygon',
        coordinates: arcgisGeom.rings || []
      };

    case 'esriGeometryPolyline':
      // ArcGIS polyline: { paths: [[[x,y], [x,y], ...]] }
      if (arcgisGeom.paths && arcgisGeom.paths.length === 1) {
        return {
          type: 'LineString',
          coordinates: arcgisGeom.paths[0]
        };
      }
      return {
        type: 'MultiLineString',
        coordinates: arcgisGeom.paths || []
      };

    case 'esriGeometryPoint':
      // ArcGIS point: { x: number, y: number }
      return {
        type: 'Point',
        coordinates: [arcgisGeom.x, arcgisGeom.y]
      };

    case 'esriGeometryMultipoint':
      // ArcGIS multipoint: { points: [[x,y], [x,y], ...] }
      return {
        type: 'MultiPoint',
        coordinates: arcgisGeom.points || []
      };

    default:
      console.warn(`Unknown geometry type: ${geometryType}`);
      return arcgisGeom;
  }
}

/**
 * Fetch all features from an ArcGIS layer
 */
async function fetchLayerFeatures(url: string): Promise<ArcGISResponse> {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1', // Get all features
    outFields: '*',
    returnGeometry: 'true',
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326', // WGS84 (lat/lng)
    outSR: '4326' // Output in WGS84 for GeoJSON compatibility
  });

  const fullUrl = `${url}?${params.toString()}`;
  console.log(`Fetching: ${fullUrl}`);

  const response = await fetch(fullUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data: ArcGISResponse = await response.json();

  if (!data.features || data.features.length === 0) {
    console.warn('⚠️  No features returned');
  } else {
    console.log(`✅ Fetched ${data.features.length} features`);
  }

  return data;
}

/**
 * Convert ArcGIS response to GeoJSON FeatureCollection
 */
function convertToGeoJSON(arcgisData: ArcGISResponse, metadata: typeof LAYERS[0]): any {
  const features = (arcgisData.features || []).map((feature) => ({
    type: 'Feature',
    geometry: arcgisToGeoJSON(feature.geometry, arcgisData.geometryType || 'esriGeometryPolygon'),
    properties: {
      ...feature.attributes,
      _layer_name: metadata.name,
      _layer_title: metadata.title,
      _layer_color: metadata.color
    }
  }));

  return {
    type: 'FeatureCollection',
    name: metadata.name,
    metadata: {
      title: metadata.title,
      description: metadata.description,
      color: metadata.color,
      source: 'Layton City ArcGIS',
      source_url: metadata.url,
      fetched_at: new Date().toISOString(),
      feature_count: features.length
    },
    features
  };
}

/**
 * Main function to fetch all layers
 */
async function main() {
  console.log('🗺️  Fetching Layton City overlay layers...\n');

  // Create output directory
  const outputDir = path.join(process.cwd(), 'data', 'layton-overlays');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results: any[] = [];

  for (const layer of LAYERS) {
    console.log(`\n📦 Processing: ${layer.title}`);
    console.log(`   URL: ${layer.url}`);

    try {
      // Fetch data from ArcGIS
      const arcgisData = await fetchLayerFeatures(layer.url);

      // Convert to GeoJSON
      const geojson = convertToGeoJSON(arcgisData, layer);

      // Save to file
      const filename = `${layer.name}.geojson`;
      const filepath = path.join(outputDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2));

      console.log(`   ✅ Saved: ${filepath}`);
      console.log(`   Features: ${geojson.features.length}`);

      results.push({
        name: layer.name,
        title: layer.title,
        filename,
        feature_count: geojson.features.length,
        color: layer.color,
        description: layer.description
      });

      // Small delay to be nice to the server
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`   ❌ Failed to fetch ${layer.title}:`, error);
      results.push({
        name: layer.name,
        title: layer.title,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Save summary
  const summaryPath = path.join(outputDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    fetched_at: new Date().toISOString(),
    layers: results,
    total_layers: LAYERS.length,
    successful: results.filter(r => !r.error).length,
    failed: results.filter(r => r.error).length
  }, null, 2));

  console.log(`\n\n✅ Done! Summary saved to: ${summaryPath}`);
  console.log(`\n📊 Results:`);
  results.forEach(r => {
    if (r.error) {
      console.log(`   ❌ ${r.title}: ${r.error}`);
    } else {
      console.log(`   ✅ ${r.title}: ${r.feature_count} features`);
    }
  });

  console.log(`\n💾 GeoJSON files saved to: ${outputDir}`);
  console.log(`\n🚀 Next steps:`);
  console.log(`   1. Review the GeoJSON files in ${outputDir}`);
  console.log(`   2. Run the Supabase upload script (coming next)`);
}

main().catch(console.error);

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'backend', 'bike_lanes', 'campus-bike-lanes.geojson');
const target = join(root, 'mobile', 'src', 'map', 'bikeLanes.generated.ts');
const data = JSON.parse(readFileSync(source, 'utf8'));
if (data.type !== 'FeatureCollection' || data.metadata?.license !== 'ODbL-1.0' || !Array.isArray(data.features)) {
  throw new Error('Unexpected campus bike-lane source');
}
const present = data.features.filter(feature => feature.properties?.bike_lane === 'present');
if (!present.length || present.some(feature => feature.geometry?.type !== 'LineString'
  || feature.geometry.coordinates.length < 2
  || feature.geometry.coordinates.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value))))) {
  throw new Error('Invalid present bike-lane geometry');
}
const geometry = { type: 'Feature', properties: {}, geometry: {
  type: 'MultiLineString', coordinates: present.map(feature => feature.geometry.coordinates),
} };
const output = `export const BIKE_LANES: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'MultiLineString'; coordinates: number[][][] } } = ${JSON.stringify(geometry)};\n`
  + `export const BIKE_LANE_SEGMENT_COUNT = ${present.length};\n`
  + `export const BIKE_LANE_SNAPSHOT = ${JSON.stringify(data.metadata.osm_snapshot)};\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
    throw new Error('Bike-lane asset is stale; run npm run bike-lanes:generate --prefix mobile');
  }
} else {
  writeFileSync(target, output);
}

// Derives assets/maps/bypass-night.json (the film's night map, decision 026) from the bundled Fiord
// style. Fiord's sources, layer order, filters, zoom ranges and widths are kept; only colours,
// opacities and label spacing change, so the result stays a valid style for the same tiles.
// `--check` fails if the committed file is stale. No network access and no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'assets', 'maps', 'fiord.json');
const target = join(root, 'assets', 'maps', 'bypass-night.json');

const C = {
  ground: '#0B0D14', land: '#11141F', water: '#0A1220', wood: '#0D1418', park: '#0F1A1C', parkEdge: '#1C3A38',
  building: '#151929', casing: '#151929', street: '#2B3250', major: '#333B5E', motorway: '#3A4368', path: '#3A4266',
  rail: '#151929', railDash: '#3A4266', boundary: '#2C3146', label: '#8E97BA', place: '#C5CBE3', quiet: '#5E6686',
  halo: 'rgba(11,13,20,0.9)',
};

/** Paint (and a few layout) overrides for every Fiord layer. A layer missing here fails the build. */
const LAYERS = {
  background: { 'background-color': C.ground },
  water: { 'fill-color': C.water },
  landcover_ice_shelf: { 'fill-color': C.land },
  landuse_residential: { 'fill-color': C.land, 'fill-opacity': 0.6 },
  landcover_wood: { 'fill-color': C.wood },
  park: { 'fill-color': C.park, 'fill-opacity': 0.7 },
  park_outline: { 'line-color': C.parkEdge },
  waterway: { 'line-color': C.water, 'line-opacity': 1 },
  building: { 'fill-color': C.building, 'fill-opacity': 0.55 },
  tunnel_motorway_casing: { 'line-color': C.casing },
  tunnel_motorway_inner: { 'line-color': '#222840' },
  'aeroway-taxiway': { 'line-color': '#1B2033' },
  'aeroway-runway-casing': { 'line-color': '#1B2033' },
  'aeroway-area': { 'fill-color': '#141827' },
  'aeroway-runway': { 'line-color': '#222840' },
  road_area_pier: { 'fill-color': C.land },
  road_pier: { 'line-color': C.land },
  highway_path: { 'line-color': C.path },
  highway_minor: { 'line-color': C.street, 'line-opacity': 1 },
  highway_major_casing: { 'line-color': C.casing },
  highway_major_inner: { 'line-color': C.major },
  highway_major_subtle: { 'line-color': C.street, 'line-opacity': 0.8 },
  highway_motorway_casing: { 'line-color': C.casing },
  highway_motorway_inner: { 'line-color': C.motorway },
  highway_motorway_subtle: { 'line-color': 'rgba(74,83,120,0.45)' },
  railway_transit: { 'line-color': C.rail },
  railway_transit_dashline: { 'line-color': C.railDash },
  railway_service: { 'line-color': C.rail },
  railway_service_dashline: { 'line-color': C.railDash },
  railway: { 'line-color': C.rail },
  railway_dashline: { 'line-color': C.railDash },
  water_name: { 'text-color': C.quiet, 'text-halo-color': C.halo },
  // Street names as in the film: letter-spaced capitals (Fiord already sets text-transform).
  highway_name_other: { 'text-color': C.label, 'text-halo-color': C.halo, layout: { 'text-letter-spacing': 0.12 } },
  highway_ref: { 'text-color': C.label, 'text-halo-color': C.casing },
  boundary_state: { 'line-color': C.boundary },
  'boundary_country_z0-4': { 'line-color': '#4A5378' },
  'boundary_country_z5-': { 'line-color': '#4A5378' },
  place_other: { 'text-color': C.label, 'text-halo-color': C.halo },
  place_suburb: { 'text-color': C.label, 'text-halo-color': C.halo },
  place_village: { 'text-color': C.label, 'text-halo-color': C.halo },
  place_town: { 'text-color': C.place, 'text-halo-color': C.halo },
  place_city: { 'text-color': C.place, 'text-halo-color': C.halo },
  place_city_large: { 'text-color': C.place, 'text-halo-color': C.halo },
  place_state: { 'text-color': C.quiet, 'text-halo-color': C.halo },
  place_country_other: { 'text-color': C.label, 'text-halo-color': C.halo },
  place_country_minor: { 'text-color': C.label, 'text-halo-color': C.halo },
  place_country_major: { 'text-color': C.label, 'text-halo-color': C.halo },
  place_continent: { 'text-color': C.place, 'text-halo-color': C.halo },
};

const fiord = JSON.parse(readFileSync(source, 'utf8'));
const seen = new Set();
const layers = fiord.layers.map(layer => {
  const override = LAYERS[layer.id];
  if (!override) throw new Error(`Fiord layer "${layer.id}" has no night colours; add it to scripts/build-night-style.mjs`);
  seen.add(layer.id);
  const { layout, ...paint } = override;
  for (const key of Object.keys(paint)) {
    if (!key.startsWith(layer.type === 'symbol' ? 'text-' : `${layer.type}-`)) throw new Error(`${layer.id}: ${key} is not a ${layer.type} paint property`);
  }
  return { ...layer, paint: { ...layer.paint, ...paint }, ...(layout ? { layout: { ...layer.layout, ...layout } } : {}) };
});
for (const id of Object.keys(LAYERS)) if (!seen.has(id)) throw new Error(`night colours name "${id}", which Fiord no longer has`);

const night = { ...fiord, name: 'Bypass Night (adapted from Fiord Color)', id: 'bypass-night', layers };
const text = JSON.stringify(night, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text) throw new Error('assets/maps/bypass-night.json is stale; run npm run map:night');
  console.log('night style: up to date');
} else {
  writeFileSync(target, text);
  console.log(`night style: ${layers.length} layers -> assets/maps/bypass-night.json`);
}

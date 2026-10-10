// Shared fakes for collector tests: controlled clock, memory storage, deterministic UUIDs.
const G = 9.80665;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data, failWrites: false,
    async getItem(key) { return data.has(key) ? data.get(key) : null; },
    async setItem(key, value) { if (this.failWrites) throw new Error('disk full'); data.set(key, value); },
  };
}

function uuids(prefix = 0) {
  let n = 0;
  return () => {
    const hex = (++n).toString(16).padStart(12, '0');
    return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${hex}`;
  };
}

/** Point `meters` north of the origin along a straight line. */
const north = (meters, origin = { lat: 33.75, lon: -84.385 }) => ({ lat: origin.lat + meters / 111_194.93, lon: origin.lon });

const flat = (ax = 0, ay = 0, az = 0) => ({
  acceleration: { x: ax, y: ay, z: az },
  accelerationIncludingGravity: { x: ax, y: ay, z: az + G },
  interval: 20,
});

module.exports = { G, memoryStorage, uuids, north, flat };

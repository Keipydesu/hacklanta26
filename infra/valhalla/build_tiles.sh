#!/usr/bin/env bash
# Build routing tiles for the campus area and switch to them only after a real route works.
# Tile building is separate from serving: never run this as part of API or Compose startup.
#
#   infra/valhalla/build_tiles.sh EXTRACT.osm.pbf        # use an extract you already have
#   infra/valhalla/build_tiles.sh --campus               # small GSU extract from Overpass, no osmium needed
#   infra/valhalla/build_tiles.sh --geofabrik            # download Georgia and clip metro Atlanta (needs osmium)
#
# Output (ignored by git) under infra/valhalla/custom_files/:
#   valhalla.json, valhalla_tiles.tar   what the valhalla service mounts read-only
#   manifest.json                       source, checksum, date, bbox and engine image
#   previous/                           the tile set this build replaced, kept for rollback
#
# Run once on 2026-10-10 against a small campus-area OSM extract with ghcr.io/valhalla/valhalla:3.9.1
# (build, validation route, promotion). Resource needs for the full Georgia extract are still unmeasured.
set -euo pipefail
. "$(dirname "$0")/../lib.sh"

IMAGE="${VALHALLA_IMAGE:-$( [ -f "$ENV_FILE" ] && env_value VALHALLA_IMAGE || true )}"
IMAGE="${IMAGE:-ghcr.io/valhalla/valhalla:3.9.1}"
BBOX="${BBOX:--84.55,33.60,-84.20,33.95}"            # metro Atlanta: minLon,minLat,maxLon,maxLat
GEOFABRIK_URL="https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf"
OUT="$INFRA_DIR/valhalla/custom_files"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/valhalla-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

case "${1:-}" in
  --campus)
    BBOX='-84.40,33.74,-84.37,33.77'
    SOURCE='https://overpass-api.de/api/interpreter'
    EXTRACT=extract.osm
    note "downloading GSU campus map data ($BBOX)"
    # Complete ways plus their referenced nodes; XML is accepted by Valhalla's OSM reader.
    curl -fL --retry 2 --max-time 180 \
      --user-agent 'CampusHazardMap/0.1 (local routing tile build)' --data-urlencode \
      'data=[out:xml][timeout:120];way(33.74,-84.40,33.77,-84.37);(._;>;);out body;' \
      "$SOURCE" -o "$WORK/$EXTRACT"
    python3 - "$WORK/$EXTRACT" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
if root.tag != 'osm' or root.find('remark') is not None or root.find('way') is None:
    sys.exit('Overpass did not return a complete campus extract; existing tiles are unchanged')
PY
    ;;
  --geofabrik)
    command -v osmium >/dev/null || die "--geofabrik needs osmium-tool on this machine to clip the extract"
    note "downloading $GEOFABRIK_URL"
    curl -fL --retry 3 -o "$WORK/georgia.osm.pbf" "$GEOFABRIK_URL"
    SOURCE="$GEOFABRIK_URL"
    note "clipping to $BBOX"
    osmium extract --bbox "$BBOX" --output "$WORK/extract.osm.pbf" "$WORK/georgia.osm.pbf"; EXTRACT=extract.osm.pbf ;;
  ""|-*) die "usage: $0 EXTRACT.osm.pbf | --campus | --geofabrik" ;;
  *)
    [ -s "$1" ] || die "extract $1 not found or empty"
    case "$1" in *.pbf) EXTRACT=extract.osm.pbf ;; *) EXTRACT=extract.osm ;; esac   # Valhalla picks the reader by extension
    cp "$1" "$WORK/$EXTRACT"; SOURCE="$(basename "$1")" ;;
esac
EXTRACT="${EXTRACT:-extract.osm.pbf}"
# sha256sum is GNU-only; macOS has shasum.
if command -v sha256sum >/dev/null; then checksum="$(sha256sum "$WORK/$EXTRACT" | cut -d' ' -f1)"; else checksum="$(shasum -a 256 "$WORK/$EXTRACT" | cut -d' ' -f1)"; fi

note "building tiles with $IMAGE (peak memory and time depend on the extract; measure them)"
docker pull --quiet "$IMAGE" >/dev/null
digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")"
mkdir -p "$WORK/out"; chmod 777 "$WORK/out"
# The build mounts its output at /custom_files, the same path the serving container uses, so every path
# written into valhalla.json (tiles, extract, admin and timezone databases) is valid when it is served.
docker run --rm -v "$WORK/out:/custom_files" -v "$WORK/$EXTRACT:/input/$EXTRACT:ro" "$IMAGE" sh -euc "
  valhalla_build_config --mjolnir-tile-dir /custom_files/valhalla_tiles --mjolnir-tile-extract /custom_files/valhalla_tiles.tar \
    --mjolnir-admin /custom_files/admin.sqlite --mjolnir-timezone /custom_files/tz.sqlite > /custom_files/valhalla.json
  valhalla_build_tiles -c /custom_files/valhalla.json /input/$EXTRACT
  valhalla_build_extract -c /custom_files/valhalla.json -v
"
[ -s "$WORK/out/valhalla_tiles.tar" ] || die "tile build produced no tiles"

note "validating: a real pedestrian route across the GSU campus on the new tiles"
name="valhalla-validate-$$"
docker run -d --rm --name "$name" -p 127.0.0.1:18002:8002 -v "$WORK/out:/custom_files:ro" "$IMAGE" valhalla_service /custom_files/valhalla.json 1 >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
request='{"locations":[{"lat":33.7531,"lon":-84.3853},{"lat":33.7560,"lon":-84.3880}],"costing":"pedestrian","costing_options":{"pedestrian":{"walking_speed":16,"step_penalty":600}},"units":"kilometers"}'
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 -H 'Content-Type: application/json' -d "$request" http://127.0.0.1:18002/route -o "$WORK/route.json" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
docker stop "$name" >/dev/null 2>&1 || true
[ "$ok" = 1 ] || die "the new tiles did not answer a GSU route; the existing tile set is unchanged"
length="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["trip"]["summary"]["length"])' "$WORK/route.json")"
note "GSU sample route: ${length} km"

note "promoting the validated tile set (previous set kept in custom_files/previous)"
mkdir -p "$OUT"
if [ -f "$OUT/valhalla_tiles.tar" ]; then
  rm -rf "$OUT/previous"; mkdir -p "$OUT/previous"
  mv "$OUT/valhalla_tiles.tar" "$OUT/valhalla.json" "$OUT/admin.sqlite" "$OUT/tz.sqlite" "$OUT/previous/" 2>/dev/null || true
  [ -f "$OUT/manifest.json" ] && mv "$OUT/manifest.json" "$OUT/previous/"
fi
cp "$WORK/out/valhalla.json" "$OUT/valhalla.json"
mv "$WORK/out/valhalla_tiles.tar" "$OUT/valhalla_tiles.tar"
for extra in admin.sqlite tz.sqlite; do [ -f "$WORK/out/$extra" ] && mv "$WORK/out/$extra" "$OUT/$extra"; done
cat > "$OUT/manifest.json" <<JSON
{
  "built": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "$SOURCE",
  "extract_sha256": "$checksum",
  "bbox": "$BBOX",
  "engine_image": "$digest",
  "sample_route_km": $length,
  "attribution": "Map data © OpenStreetMap contributors, ODbL"
}
JSON
echo "tiles ready in $OUT. Start routing with: VALHALLA_URL=http://valhalla:8002 in infra/.env and --profile routing"

#!/usr/bin/env bash
# Build routing tiles for the campus area and switch to them only after a real route works.
# Tile building is separate from serving: never run this as part of API or Compose startup.
#
#   infra/valhalla/build_tiles.sh EXTRACT.osm.pbf        # use an extract you already have
#   infra/valhalla/build_tiles.sh --geofabrik            # download Georgia and clip metro Atlanta (needs osmium)
#
# Output (ignored by git) under infra/valhalla/custom_files/:
#   valhalla.json, valhalla_tiles.tar   what the valhalla service mounts read-only
#   manifest.json                       source, checksum, date, bbox and engine image
#   previous/                           the tile set this build replaced, kept for rollback
#
# NOT YET RUN where this was written. The image tag, config flags and resource needs must be
# confirmed on first use; record what you measured in infra/README.md.
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
  --geofabrik)
    command -v osmium >/dev/null || die "--geofabrik needs osmium-tool on this machine to clip the extract"
    note "downloading $GEOFABRIK_URL"
    curl -fL --retry 3 -o "$WORK/georgia.osm.pbf" "$GEOFABRIK_URL"
    SOURCE="$GEOFABRIK_URL"
    note "clipping to $BBOX"
    osmium extract --bbox "$BBOX" --output "$WORK/extract.osm.pbf" "$WORK/georgia.osm.pbf" ;;
  ""|-*) die "usage: $0 EXTRACT.osm.pbf | --geofabrik" ;;
  *)
    [ -s "$1" ] || die "extract $1 not found or empty"
    cp "$1" "$WORK/extract.osm.pbf"; SOURCE="$(basename "$1")" ;;
esac
checksum="$(sha256sum "$WORK/extract.osm.pbf" | cut -d' ' -f1)"

note "building tiles with $IMAGE (peak memory and time depend on the extract; measure them)"
docker pull --quiet "$IMAGE" >/dev/null
digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")"
mkdir -p "$WORK/out"; chmod 777 "$WORK/out"
docker run --rm -v "$WORK:/build" "$IMAGE" sh -euc '
  valhalla_build_config --mjolnir-tile-dir /build/out/valhalla_tiles --mjolnir-tile-extract /custom_files/valhalla_tiles.tar \
    --mjolnir-admin /build/out/admin.sqlite --mjolnir-timezone /build/out/tz.sqlite > /build/out/valhalla.json
  valhalla_build_tiles -c /build/out/valhalla.json /build/extract.osm.pbf
  tar -cf /build/out/valhalla_tiles.tar -C /build/out/valhalla_tiles .
'
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
  mv "$OUT/valhalla_tiles.tar" "$OUT/valhalla.json" "$OUT/previous/" 2>/dev/null || true
  [ -f "$OUT/manifest.json" ] && mv "$OUT/manifest.json" "$OUT/previous/"
fi
cp "$WORK/out/valhalla.json" "$OUT/valhalla.json"
mv "$WORK/out/valhalla_tiles.tar" "$OUT/valhalla_tiles.tar"
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

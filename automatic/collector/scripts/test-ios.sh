#!/usr/bin/env bash
set -euo pipefail

collector_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plan="${1:-CollectorSimulator}"
destination="${2:-}"
artifacts="${3:-${collector_dir}/artifacts/ios/$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ "$plan" != CollectorSimulator && "$plan" != CollectorDevice ]]; then
  echo 'Usage: scripts/test-ios.sh CollectorSimulator|CollectorDevice DESTINATION [ARTIFACT_DIR]' >&2
  exit 2
fi
if [[ -z "$destination" ]]; then
  echo 'Supply an xcodebuild -destination, for example platform=iOS Simulator,id=UDID.' >&2
  exit 2
fi
developer_dir="$(xcode-select -p 2>/dev/null || true)"
if [[ "$developer_dir" != *Xcode.app/Contents/Developer ]]; then
  echo 'Full Xcode is required; Command Line Tools alone cannot run XCTest.' >&2
  exit 2
fi
command -v pod >/dev/null || { echo 'CocoaPods (pod) is required.' >&2; exit 2; }

if [[ "$plan" == CollectorSimulator ]]; then
  export EXPO_PUBLIC_COLLECTOR_UI_TEST=1
  signing=(CODE_SIGNING_ALLOWED=NO)
else
  export EXPO_PUBLIC_COLLECTOR_UI_TEST=0
  : "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM to your Apple team ID for a signed iPhone build}"
  signing=("DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}")
fi

mkdir -p "$artifacts"
cd "$collector_dir"
EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform ios --no-install
(cd ios && pod install) >"$artifacts/pod-install.log" 2>&1

# Release embeds the JS bundle with the selected fixture flag. No Metro process is needed.
# This avoids a UI runner racing an unready development server.
set +e
xcodebuild test \
  -workspace ios/CampusCollector.xcworkspace \
  -scheme CampusCollector \
  -testPlan "$plan" \
  -configuration Release \
  -destination "$destination" \
  -derivedDataPath "$artifacts/DerivedData" \
  -resultBundlePath "$artifacts/Collector.xcresult" \
  "${signing[@]}" \
  2>&1 | tee "$artifacts/xcodebuild.log"
result=${PIPESTATUS[0]}
set -e
echo "XCTest result: $artifacts/Collector.xcresult"
echo "Build log: $artifacts/xcodebuild.log"
exit "$result"

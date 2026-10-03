#!/usr/bin/env bash
# Build an Android APK/AAB for PA Control.
#
# Usage: scripts/build-android.sh [options]
#   -t, --type <release|debug>   Build variant (default: release)
#   -f, --format <apk|aab>       Output format (default: apk; use aab for Play Store)
#   -c, --clean                  Regenerate android/ from scratch with `expo prebuild`
#   -i, --install                Install the APK on a connected device via adb
#   -o, --out <dir>              Where to copy the artifact (default: build-output)
#   -e, --eas [profile]          Build in the cloud with EAS instead (default profile: preview)
#   -h, --help                   Show this help
#
# Release signing: by default the release build is signed with the debug keystore
# (as configured by prebuild). To sign with your own key, export:
#   ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BUILD_TYPE="release"
FORMAT="apk"
CLEAN=0
INSTALL=0
OUT_DIR="build-output"
EAS_PROFILE=""

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
usage() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--type)    BUILD_TYPE="${2:-}"; shift 2 ;;
    -f|--format)  FORMAT="${2:-}"; shift 2 ;;
    -c|--clean)   CLEAN=1; shift ;;
    -i|--install) INSTALL=1; shift ;;
    -o|--out)     OUT_DIR="${2:-}"; shift 2 ;;
    -e|--eas)
      if [[ -n "${2:-}" && "${2:0:1}" != "-" ]]; then EAS_PROFILE="$2"; shift 2
      else EAS_PROFILE="preview"; shift; fi ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

[[ "$BUILD_TYPE" == "release" || "$BUILD_TYPE" == "debug" ]] || die "--type must be release or debug"
[[ "$FORMAT" == "apk" || "$FORMAT" == "aab" ]] || die "--format must be apk or aab"

command -v node >/dev/null || die "node is not installed"
command -v npx  >/dev/null || die "npx is not installed"

# ---- Cloud build via EAS ----------------------------------------------------
if [[ -n "$EAS_PROFILE" ]]; then
  info "Starting EAS build (profile: $EAS_PROFILE)"
  exec npx eas-cli build -p android --profile "$EAS_PROFILE"
fi

# ---- Local build prerequisites ----------------------------------------------
command -v java >/dev/null || die "Java (JDK 17+) is required for Gradle builds"

if [[ -z "${ANDROID_HOME:-}" ]]; then
  for candidate in "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then export ANDROID_HOME="$candidate"; break; fi
  done
fi
[[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]] || die "Android SDK not found; set ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
info "Using Android SDK at $ANDROID_HOME"

if [[ ! -d node_modules ]]; then
  info "Installing npm dependencies"
  npm ci
fi

# ---- Native project ---------------------------------------------------------
if [[ $CLEAN -eq 1 || ! -f android/gradlew ]]; then
  info "Generating native android project (expo prebuild)"
  PREBUILD_ARGS=(-p android --no-install)
  # Expo 57 recreates native folders by default; keep them unless --clean was asked for.
  [[ $CLEAN -eq 1 ]] || PREBUILD_ARGS+=(--no-clean)
  CI=1 npx expo prebuild "${PREBUILD_ARGS[@]}"
fi

# ---- Gradle build -----------------------------------------------------------
VARIANT="$(tr '[:lower:]' '[:upper:]' <<< "${BUILD_TYPE:0:1}")${BUILD_TYPE:1}"
if [[ "$FORMAT" == "aab" ]]; then
  TASK="bundle${VARIANT}"
  ARTIFACT="android/app/build/outputs/bundle/${BUILD_TYPE}/app-${BUILD_TYPE}.aab"
else
  TASK="assemble${VARIANT}"
  ARTIFACT="android/app/build/outputs/apk/${BUILD_TYPE}/app-${BUILD_TYPE}.apk"
fi

GRADLE_ARGS=("$TASK")
if [[ "$BUILD_TYPE" == "release" ]]; then
  export NODE_ENV=production
  if [[ -n "${ANDROID_KEYSTORE_FILE:-}" ]]; then
    [[ -f "$ANDROID_KEYSTORE_FILE" ]] || die "Keystore not found: $ANDROID_KEYSTORE_FILE"
    : "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required}"
    : "${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS is required}"
    : "${ANDROID_KEY_PASSWORD:?ANDROID_KEY_PASSWORD is required}"
    info "Signing with keystore $ANDROID_KEYSTORE_FILE"
    GRADLE_ARGS+=(
      "-Pandroid.injected.signing.store.file=$(realpath "$ANDROID_KEYSTORE_FILE")"
      "-Pandroid.injected.signing.store.password=$ANDROID_KEYSTORE_PASSWORD"
      "-Pandroid.injected.signing.key.alias=$ANDROID_KEY_ALIAS"
      "-Pandroid.injected.signing.key.password=$ANDROID_KEY_PASSWORD"
    )
  else
    info "No ANDROID_KEYSTORE_FILE set — release will be signed with the debug keystore"
  fi
fi

info "Running ./gradlew $TASK"
(cd android && ./gradlew "${GRADLE_ARGS[@]}")

[[ -f "$ARTIFACT" ]] || die "Build finished but artifact not found at $ARTIFACT"

# ---- Collect artifact -------------------------------------------------------
APP_VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/pa-control-${APP_VERSION}-${BUILD_TYPE}-$(date +%Y%m%d-%H%M).${FORMAT}"
cp "$ARTIFACT" "$DEST"
ok "Built $DEST ($(du -h "$DEST" | cut -f1))"

if [[ $INSTALL -eq 1 ]]; then
  [[ "$FORMAT" == "apk" ]] || die "--install only works with --format apk"
  command -v adb >/dev/null || ADB="$ANDROID_HOME/platform-tools/adb"
  "${ADB:-adb}" install -r "$DEST"
  ok "Installed on device"
fi

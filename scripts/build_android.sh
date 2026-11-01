#!/usr/bin/env bash
#
# Build the native payload that ships inside the Android app.
#
# Two things are produced for a single Android ABI:
#
#   libollama.so       the Go Ollama CLI/server binary
#   libllama-server.so the llama.cpp inference server (statically linked)
#
# Both are named lib*.so on purpose: the Android package manager only extracts
# files matching lib*.so into the app's native library directory, and on modern
# Android that read-only directory is the only place an app is allowed to
# execute binaries from. Ollama finds these names automatically (see
# llm/llama_binary.go and ml/path.go).
#
# Requirements: Go (matching go.mod), CMake >= 3.24, Ninja (recommended), and
# an Android NDK r26+ reachable through ANDROID_NDK_HOME, ANDROID_NDK_ROOT,
# ANDROID_NDK, or "$ANDROID_HOME/ndk/<version>".
#
# Usage:
#   scripts/build_android.sh                 # arm64-v8a (phones/tablets)
#   scripts/build_android.sh -a x86_64       # emulator
#   OLLAMA_ANDROID_SKIP_LLAMA_SERVER=1 scripts/build_android.sh
#
set -eu

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

ABI="${OLLAMA_ANDROID_ABI:-arm64-v8a}"
API_LEVEL="${OLLAMA_ANDROID_API_LEVEL:-26}"
OUT_DIR="${OLLAMA_ANDROID_OUT_DIR:-dist/android}"
SKIP_LLAMA_SERVER="${OLLAMA_ANDROID_SKIP_LLAMA_SERVER:-0}"
JNI_LIBS_DIR="${OLLAMA_ANDROID_JNI_LIBS_DIR:-android/app/src/main/jniLibs}"
ASSETS_LICENSE_DIR="android/app/src/main/assets/licenses"

status() { echo >&2 ">>> $*"; }
fail() {
	echo >&2 "!!! $*"
	exit 1
}

usage() {
	cat >&2 <<'EOF'
usage: scripts/build_android.sh [-a <abi>] [-h]

  -a <abi>  Android ABI to build: arm64-v8a (default) or x86_64
  -h        show this help

Environment:
  OLLAMA_ANDROID_ABI                  same as -a
  OLLAMA_ANDROID_API_LEVEL            Android API level (default 26)
  OLLAMA_ANDROID_OUT_DIR              output directory (default dist/android)
  OLLAMA_ANDROID_JNI_LIBS_DIR         jniLibs root (default android/app/src/main/jniLibs)
  OLLAMA_ANDROID_SKIP_LLAMA_SERVER=1  reuse an existing llama-server build
  ANDROID_NDK_HOME / ANDROID_NDK_ROOT / ANDROID_NDK / ANDROID_HOME
EOF
	exit 1
}

while getopts "a:h" OPTION; do
	case "$OPTION" in
	a) ABI="$OPTARG" ;;
	*) usage ;;
	esac
done

case "$ABI" in
arm64-v8a)
	GOARCH_VAL=arm64
	NDK_TRIPLE=aarch64-linux-android
	;;
x86_64)
	GOARCH_VAL=amd64
	NDK_TRIPLE=x86_64-linux-android
	;;
armv7a | armeabi-v7a)
	GOARCH_VAL=arm
	NDK_TRIPLE=armv7a-linux-androideabi
	;;
*)
	fail "unsupported ABI: $ABI (expected arm64-v8a, x86_64, or armeabi-v7a)"
	;;
esac

find_ndk() {
	for candidate in \
		"${ANDROID_NDK_HOME:-}" \
		"${ANDROID_NDK_ROOT:-}" \
		"${ANDROID_NDK:-}" \
		"${ANDROID_NDK_LATEST_HOME:-}"; do
		if [ -n "$candidate" ] && [ -d "$candidate" ]; then
			echo "$candidate"
			return 0
		fi
	done

	for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
		if [ -n "$sdk" ] && [ -d "$sdk/ndk" ]; then
			# Prefer the highest installed NDK version.
			latest="$(ls -1 "$sdk/ndk" | sort -V | tail -1)"
			if [ -n "$latest" ] && [ -d "$sdk/ndk/$latest" ]; then
				echo "$sdk/ndk/$latest"
				return 0
			fi
		fi
	done

	return 1
}

NDK="$(find_ndk || true)"
if [ -z "$NDK" ]; then
	fail "Android NDK not found. Set ANDROID_NDK_HOME (or install the NDK under \$ANDROID_HOME/ndk)."
fi

HOST_TAG=""
case "$(uname -s)" in
Darwin) HOST_TAG=darwin-x86_64 ;;
Linux) HOST_TAG=linux-x86_64 ;;
*) fail "unsupported host $(uname -s)" ;;
esac
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG"
[ -d "$TOOLCHAIN" ] || fail "NDK toolchain not found at $TOOLCHAIN"

CLANG="$TOOLCHAIN/bin/${NDK_TRIPLE}${API_LEVEL}-clang"
CLANGXX="$TOOLCHAIN/bin/${NDK_TRIPLE}${API_LEVEL}-clang++"
if [ ! -x "$CLANG" ]; then
	# armeabi-v7a toolchains are named after the armv7a triple only in older NDKs.
	CLANG="$TOOLCHAIN/bin/${NDK_TRIPLE}-clang"
	CLANGXX="$TOOLCHAIN/bin/${NDK_TRIPLE}-clang++"
fi
[ -x "$CLANG" ] || fail "NDK clang not found for $NDK_TRIPLE (API $API_LEVEL) in $TOOLCHAIN/bin"

# Resolve output locations relative to the repository root unless absolute.
case "$OUT_DIR" in
/*) OUT_BASE="$OUT_DIR" ;;
*) OUT_BASE="$REPO_ROOT/$OUT_DIR" ;;
esac
case "$JNI_LIBS_DIR" in
/*) JNI_LIBS_BASE="$JNI_LIBS_DIR" ;;
*) JNI_LIBS_BASE="$REPO_ROOT/$JNI_LIBS_DIR" ;;
esac
case "$ASSETS_LICENSE_DIR" in
/*) ASSETS_LICENSE_BASE="$ASSETS_LICENSE_DIR" ;;
*) ASSETS_LICENSE_BASE="$REPO_ROOT/$ASSETS_LICENSE_DIR" ;;
esac

mkdir -p "$OUT_BASE/$ABI" "$JNI_LIBS_BASE/$ABI" "$ASSETS_LICENSE_BASE"

VERSION="${VERSION:-$(git describe --tags --first-parent --abbrev=7 --long --dirty --always 2>/dev/null | sed -e 's/^v//g' || echo "0.0.0")}"

# ---------------------------------------------------------------------------
# 1. llama.cpp inference server
# ---------------------------------------------------------------------------
LLAMA_STAGE="$OUT_BASE/$ABI/payload"
LLAMA_BUILD="$REPO_ROOT/build/android-$ABI"

if [ "$SKIP_LLAMA_SERVER" != "1" ]; then
	status "Building llama-server for $ABI (API $API_LEVEL)"
	status "NDK: $NDK"

	GENERATOR_ARGS=""
	if command -v ninja >/dev/null 2>&1; then
		GENERATOR_ARGS="-G Ninja"
	fi

	# shellcheck disable=SC2086
	cmake -S llama/server -B "$LLAMA_BUILD" $GENERATOR_ARGS \
		-DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
		-DANDROID_ABI="$ABI" \
		-DANDROID_PLATFORM="android-$API_LEVEL" \
		-DCMAKE_BUILD_TYPE=Release \
		-DCMAKE_INSTALL_PREFIX="$LLAMA_STAGE" \
		-DCMAKE_EXE_LINKER_FLAGS="-Wl,-z,max-page-size=16384" \
		-DBUILD_SHARED_LIBS=OFF \
		-DGGML_BACKEND_DL=OFF \
		-DGGML_NATIVE=OFF \
		-DGGML_OPENMP=OFF \
		-DGGML_LLAMAFILE=OFF \
		-DGGML_CPU_ALL_VARIANTS=OFF \
		-DLLAMA_CURL=OFF \
		-DLLAMA_OPENSSL=OFF \
		-DOLLAMA_RUNNER_DIR=

	cmake --build "$LLAMA_BUILD" --target llama-server -j "${OLLAMA_BUILD_PARALLEL:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
	cmake --install "$LLAMA_BUILD" --component llama-server --prefix "$LLAMA_STAGE"
else
	status "Reusing existing llama-server build in $LLAMA_STAGE"
fi

LLAMA_SERVER_BIN="$LLAMA_STAGE/lib/ollama/llama-server"
[ -f "$LLAMA_SERVER_BIN" ] || fail "llama-server was not produced at $LLAMA_SERVER_BIN"

# Release builds of llama-server keep DWARF debug info, which is useless on a
# phone and dominates the binary size. Strip only the debug sections so symbol
# tables and everything the loader needs stay intact.
STRIP_BIN="$TOOLCHAIN/bin/llvm-strip"
if [ -x "$STRIP_BIN" ]; then
	before="$(wc -c <"$LLAMA_SERVER_BIN" | tr -d ' ')"
	"$STRIP_BIN" --strip-debug "$LLAMA_SERVER_BIN" 2>/dev/null || true
	after="$(wc -c <"$LLAMA_SERVER_BIN" | tr -d ' ')"
	status "llama-server: $before bytes -> $after bytes after stripping debug info"
fi

cp -f "$LLAMA_SERVER_BIN" "$JNI_LIBS_BASE/$ABI/libllama-server.so"
cp -f "$LLAMA_SERVER_BIN" "$OUT_BASE/$ABI/libllama-server.so"

# Third-party license texts are staged into app assets so the APK can show them.
for license in "$LLAMA_STAGE"/lib/ollama/*LICENSE*; do
	[ -f "$license" ] && cp -f "$license" "$ASSETS_LICENSE_BASE/" || true
done

# ---------------------------------------------------------------------------
# 2. Ollama itself
# ---------------------------------------------------------------------------
# Ollama always needs cgo (the MLX and discovery packages load their native
# shims dynamically), so GOOS=android with the NDK clang is the supported path.
build_ollama_android() {
	extra_ldflags="${1:-}"
	status "Building ollama for android/$GOARCH_VAL with cgo (API $API_LEVEL)"
	GOOS=android GOARCH="$GOARCH_VAL" CGO_ENABLED=1 \
		CC="$CLANG" CXX="$CLANGXX" \
		AR="$TOOLCHAIN/bin/llvm-ar" \
		NM="$TOOLCHAIN/bin/llvm-nm" \
		STRIP="$TOOLCHAIN/bin/llvm-strip" \
		CGO_CFLAGS="-O3 -fPIC" \
		CGO_CXXFLAGS="-O3 -fPIC" \
		CGO_LDFLAGS="$extra_ldflags" \
		go build -trimpath \
		-ldflags="-w -s -X=github.com/ollama/ollama/version.Version=$VERSION" \
		-o "$JNI_LIBS_BASE/$ABI/libollama.so" .
}

if command -v go >/dev/null 2>&1; then
	if ! build_ollama_android "-Wl,-z,max-page-size=16384"; then
		status "Retrying without the 16 KB page-size linker flag"
		if ! build_ollama_android ""; then
			fail "ollama android build failed. Check that the NDK provides $CLANG and that the Go toolchain matches go.mod."
		fi
	fi
else
	fail "go toolchain not found in PATH"
fi

[ -f "$JNI_LIBS_BASE/$ABI/libollama.so" ] || fail "libollama.so was not produced"
cp -f "$JNI_LIBS_BASE/$ABI/libollama.so" "$OUT_BASE/$ABI/libollama.so"

chmod 0755 "$JNI_LIBS_BASE/$ABI/libollama.so" "$JNI_LIBS_BASE/$ABI/libllama-server.so"

status "Payload for $ABI:"
ls -l "$JNI_LIBS_BASE/$ABI"
status "Copied native payload into $JNI_LIBS_BASE/$ABI"
status "Next: cd android && ./gradlew assembleDebug   (or: gradle assembleDebug)"

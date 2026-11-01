# Ollama for Android

This directory contains the Android front end for the Ollama fork in this
repository. The app bundles the Go Ollama CLI/server and the llama.cpp
inference server, runs them as child processes, and provides a dashboard, a
built-in terminal, chat, model management and connection snippets for coding
agents such as Claude Code.

For the user-facing documentation see [`docs/android.mdx`](../docs/android.mdx).

## Quick start

```shell
# from the repository root
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973   # or ANDROID_NDK_ROOT
./scripts/build_android.sh          # builds libollama.so + libllama-server.so

cd android
gradle assembleDebug                # or: ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`scripts/build_android.sh` stages the native payload into
`app/src/main/jniLibs/<abi>/`, which is git-ignored — the binaries are build
outputs, never committed.

Android Studio users can open this directory directly; the Gradle files are
self contained and only need the payload from step 1.

## Layout

```
android/
├── app/
│   ├── build.gradle                 # AGP 8.7, minSdk 26, arm64-v8a, legacy jniLibs packaging
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/licenses/         # third-party license texts staged by the build script
│       ├── jniLibs/arm64-v8a/       # libollama.so + libllama-server.so (build output)
│       ├── java/com/rllama/ollama/  # app sources
│       └── res/                     # layouts, strings, theme, icons
├── build.gradle
├── gradle.properties
└── settings.gradle
```

### Key classes

| Class | Responsibility |
| --- | --- |
| `OllamaManager` | Owns the `ollama serve` process, readiness probing, log ring buffer, command execution |
| `NativePayload` | Locates the bundled binaries and builds the child-process environment |
| `OllamaService` | Foreground service + wake locks so the server survives backgrounding |
| `TerminalActivity` | Built-in CLI (`/system/bin/sh` with Ollama's environment) |
| `ChatActivity` | Streaming chat client against `/api/chat` |
| `ModelsActivity` | List/pull/delete models, import a `.gguf` from storage via SAF |
| `ConnectActivity` | Copy/paste snippets for Claude Code, Ollama CLI, OpenAI-compatible clients |
| `SettingsActivity` | Port, LAN access, context length, parallelism, keep-alive, model directory |
| `ShellCommand` | Rewrites `ollama` / `llama-server` tokens to the in-APK executables |

## Why the binaries are named `lib*.so`

Android 10+ refuses to execute files from writable app storage, and the APK
installer only extracts entries named `lib*.so` into the app's native library
directory (the one executable location). The Go binary and the llama.cpp server
therefore ship as `libollama.so` and `libllama-server.so`. The additive lookup
fallback for the shared-library spelling lives in `llm/llama_binary.go`, and
`OLLAMA_LIBRARY_PATH` support lives in `ml/path.go`.

## Building the payload by hand

```shell
# llama.cpp server, statically linked for arm64-v8a
cmake -S llama/server -B build/android-arm64 -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_BACKEND_DL=OFF \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_LLAMAFILE=OFF -DLLAMA_CURL=OFF
cmake --build build/android-arm64 --target llama-server -j"$(nproc)"

# Ollama itself
GOOS=android GOARCH=arm64 CGO_ENABLED=1 \
  CC=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang \
  CXX=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang++ \
  go build -trimpath -o android/app/src/main/jniLibs/arm64-v8a/libollama.so .
```

Enable `OLLAMA_ANDROID_SKIP_LLAMA_SERVER=1` to reuse an existing
`build/android-arm64` tree when iterating on the app only.

## Notes and limitations

- CPU inference only for now. Vulkan (Adreno/Mali) would need the Vulkan SDK in
  the build image and a `GGML_VULKAN` build; that is a good follow-up.
- `x86_64` builds work for emulators (`scripts/build_android.sh -a x86_64`)
  but require switching `abiFilters` in `app/build.gradle`.
- The app is not on Google Play; distribute the APK directly.

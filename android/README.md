# Ollama for Android

A single-APK Android build of the Ollama runtime in this repository. The APK
contains the stock Ollama Go server/CLI and the llama.cpp inference server
compiled for `arm64-v8a`; nothing is downloaded after installation except model
weights.

There is no custom Ollama front end inside the APK. Installing it gives you the
real `ollama` binary on a phone: the app opens a console that runs the bundled
CLI, and `ollama serve` runs as a foreground service so the stock HTTP API is
available on `127.0.0.1:11434`.

## What is in the APK

| Component | APK path | Notes |
| --- | --- | --- |
| Ollama server + CLI | `lib/arm64-v8a/libollama.so` | the Go binary from this repository, built with `GOOS=android GOARCH=arm64 CGO_ENABLED=1` |
| llama.cpp inference server | `lib/arm64-v8a/libllama-server.so` | statically linked `llama-server` for `arm64-v8a`, CPU backend |
| Licenses | `assets/licenses/` | third-party notices staged by `scripts/build_android.sh` |
| App code | `classes*.dex` | console UI, foreground service, process host |

The binaries are stored as `lib*.so` because Android only extracts and marks
executable the APK entries named `lib*.so` in the app's native library
directory. Everything else about them is a normal Ollama executable.

Sizes of the current build (measured by the `android` workflow on the pushed
commit, `unzip -v` reports the same numbers for any local build):

| Entry | Uncompressed bytes | In the APK |
| --- | --- | --- |
| `lib/arm64-v8a/libollama.so` | 40,585,696 | deflated |
| `lib/arm64-v8a/libllama-server.so` | 16,169,816 | deflated |
| `classes*.dex` | ~10,100,000 | deflated |
| **APK total** | **27,420,158** | ~26 MiB on disk (a few bytes differ between builds: the version string is embedded) |

The APK is deflated, so the installed footprint is roughly the uncompressed
sum (~67 MB) before any model is pulled. `llama-server` is stripped of DWARF
debug info in `scripts/build_android.sh`; that alone took it from 204 MB to
16 MB without touching anything the loader or the model runner needs.

### Why it is far smaller than the Windows bundle

The Windows/macOS bundles ship one inference backend per GPU vendor: CUDA
(`cublas`, `cudart` — hundreds of megabytes), ROCm, Vulkan, plus several
`llama-server` variants and their runtime DLLs. That is where the ~1 GB
installer size comes from. Model weights are not part of the installer either.

Android ships a single ABI (`arm64-v8a`) with the CPU backend only, statically
linked, so the whole runtime is tens of megabytes. Adding a Vulkan or OpenCL
backend for phone GPUs is possible but is not part of this build, and it is
listed as a limitation rather than claimed as working.

## Build

```shell
# from the repository root
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973   # or ANDROID_NDK_ROOT
./scripts/build_android.sh          # stages jniLibs/arm64-v8a/{libollama,libllama-server}.so

cd android
gradle assembleDebug                # or: ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`scripts/build_android.sh` writes the native payload into
`app/src/main/jniLibs/<abi>/`, which is git-ignored: the binaries are build
outputs, never committed.

CI does the same in `.github/workflows/android.yaml` and uploads one artifact,
`ollama-android-apk`, containing `rllama-ollama-<version>-android-arm64.apk`.

## Using it

The app opens a console with the bundled CLI on `PATH`:

```shell
ollama list
ollama pull gemma3:1b
ollama run gemma3:1b "hello"
curl -s localhost:11434/api/tags
```

`ollama serve` is started when the console opens and is kept alive by a
foreground service, with Ollama's default settings: models in
`$HOME/.ollama/models` inside the app's private directory, API on
`127.0.0.1:11434`. Models are downloaded on demand with `ollama pull` (or
`ollama create`) and then work offline.

## Layout

```
android/
├── app/
│   ├── build.gradle                 # AGP 8.7, minSdk 26, arm64-v8a, legacy jniLibs packaging
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/licenses/         # third-party license texts staged by the build script
│       ├── jniLibs/arm64-v8a/       # libollama.so + libllama-server.so (build output)
│       ├── java/com/rllama/ollama/  # process host, service, console
│       └── res/                     # console layout, strings, theme, launcher icon
├── build.gradle
├── gradle.properties
└── settings.gradle
```

### App classes

| Class | Responsibility |
| --- | --- |
| `NativePayload` | Locates the bundled binaries, makes them executable, builds `HOME`/`TMPDIR`/`PATH` |
| `OllamaManager` | Runs `ollama serve` and console commands, keeps a log ring buffer |
| `OllamaService` | Foreground service + wake lock so the server survives backgrounding |
| `TerminalActivity` | The only screen: runs CLI commands through `/system/bin/sh` |
| `ShellCommand` | Maps `ollama` / `llama-server` tokens to the packaged executables |
| `App` | Creates the notification channel and the writable directories |

## Go-side changes

Upstream Ollama already spawns `llama-server` as a child process; only binary
discovery needed an Android case:

- `ml/path.go` — `OLLAMA_LIBRARY_PATH` override and an `android` layout where
  `llama-server` sits next to `ollama`.
- `llm/llama_binary.go` — accept the `lib*.so` spelling Android packaging
  forces, e.g. `libllama-server.so`.

Nothing else in the server, CLI or API is modified.

## Limitations

- `arm64-v8a` only; `x86_64` needs a different build of the payload.
- CPU inference only — no Vulkan/OpenCL backend, no GPU offload.
- The desktop chat window (`app/ui`, built for Windows/macOS) is not part of the
  APK. The phone gets the CLI and the HTTP API.
- Large models are limited by the phone's RAM; if loading fails, use a smaller
  quantisation.
- The APK is debug-signed, so it installs with "install unknown apps" enabled.

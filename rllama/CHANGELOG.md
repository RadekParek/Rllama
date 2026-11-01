# Channel log

Plain-language record of every change, newest first. "Added" = new capability,
"Changed" = existing behaviour altered, "Removed" = something deleted.

---

## 2026-11-01 — session 7: pulls that work, a real terminal, models from anywhere

### Added

- **Terminal panel** (Menu → Terminal CLI) with a Codex-style surface: prompt,
  streamed output, command history (↑/↓), Ctrl+L to clear, and one-tap chips for
  `ollama serve`, `list`, `ps`, `--version` and disk use. Commands run on the
  desktop shell (Electron main process, streamed) or — on Android — in **Termux
  through its RUN_COMMAND service**, so Termux and Rllama run side by side and
  Termux remains the backend. The web build says plainly that it has no shell.
- **`/run <command>` in the composer**: one shell command, its output posted into
  the conversation. This is the "ask it in Termux, see it in Rllama" path.
- **Native Android plugin** `RllamaNative`: subnet scan for port 11434, Termux
  status/run/open, and GGUF listing on shared storage. Registered in
  `MainActivity`, declared in the manifest with the Termux RUN_COMMAND
  permission and `READ_EXTERNAL_STORAGE` (≤ 32) plus a `<queries>` entry.
- **Scan network** in Local backend: a real scan of this machine's /24 subnets
  (Electron main process on desktop, the plugin on Android), every answer probed
  for `/api/version`, tap to switch.
- **Start Ollama**: launches `ollama serve` through the desktop shell (detached)
  or Termux, then re-probes. The daemon no longer has to be started by hand.
- **Local models panel**: Hugging Face GGUF search (repo → files → the exact
  `hf.co/<repo>:<quant>` reference, pulled into the daemon with the ordinary
  `/api/pull`) and a device scan that lists `.gguf` files in `Download/`,
  `Models/`, `PocketPal/` and imports the chosen one with `ollama create`,
  showing the command and its output.

### Changed

- **Pulls only go to a local daemon.** This is the actual fix for
  `HTTP 403 — 403` with an HTML body: with an Ollama Cloud provider present, the
  pull was being sent to `https://ollama.com/v1/api/pull`, which is Cloudflare,
  not a daemon. `planPull()` now picks the local daemon (never a cloud one),
  refuses `-cloud` models before any request, and explains both cases in one
  sentence. `pullModel()` takes a daemon URL, normalises a stray `/v1`, and sends
  no credentials.
- **Daemon discovery got a second gear**: loopback probes → LAN scan once per
  session → reconnect and retry. Addresses are normalised (`/v1`, trailing
  slash).
- Ollama errors are short: `No Ollama daemon answered at …`, `Pull failed
  (HTTP 404)`, and the HTML-403 case names the two real causes instead of dumping
  a page.
- The **catalogue's pull target** is the local daemon, and its empty state says
  that Ollama Cloud can chat but cannot download.

### Removed

- The old copy-only "Terminal CLI" text panel as the menu target (its command
  cheatsheet lives on in `CliPanel`, no longer wired to the menu).

### Not delivered, on purpose

- Termux itself is **not vendored into this repository**. It is GPLv3, ~100 MB
  with submodules, and bundling it would mean shipping someone else's app inside
  Rllama. The integration is the supported RUN_COMMAND intent instead: install
  Termux from F-Droid, allow external commands, and Rllama drives it.
- PocketPal's private model directory is not readable by another app on
  Android 11+. Rllama scans shared storage instead; models exported or copied to
  `Download/` are listed and importable.

### Tests

- New `src/core/__tests__/local.test.ts` (18 cases): pull planning incl. the
  403 path, daemon URL normalisation, cloud detection, `pullModel` refusing
  ollama.com and reporting 403/404, Hugging Face reference building and repo
  parsing, terminal fallback, and the GGUF import command. Suite **89/89**.

---

## 2026-11-01 — session 6: working local daemon, six effort levels, tighter UI

### Added

- **Daemon discovery.** `src/core/ollama.ts` now probes `/api/version` on the
  configured address plus `127.0.0.1:11434`, `localhost:11434`, the emulator host
  `10.0.2.2:11434` and `[::1]:11434`, in parallel and with a short deadline, and
  reports the reachable ones first. The app uses this in three places: on first
  paint, before every local request, and behind a new **Find daemon** button in
  Local backend that lists what answered and switches to it on tap.
- **Self-healing connection.** A local request or pull that fails is retried once
  on the address discovery finds, and the provider is updated, so the old
  `Cannot reach an Ollama daemon at 127.0.0.1:11434` dead end is gone: the app
  either reconnects or tells you no daemon is running.
- **Six effort levels** — Minimal, Low, Medium, High, Max, Ultracode — each with a
  colour (blue → green → amber → orange → red) and an animated blue/purple
  gradient for Ultracode.
- **Effort menu in the composer**: tap the effort pill to pick a level; each row
  carries a one-line explanation. Settings shows the same six as colour-coded
  cards. Ultracode additionally injects a verify-every-step system directive and
  raises the reply budget to at least 8192 tokens.

### Changed

- **Model names drop the registry namespace everywhere**: `treyleo16/Opus-5.5`
  reads `Opus-5.5` in the top bar, the composer, the picker, the thread meta and
  the pull notices. The full id stays in the tooltip. Tags are kept, because
  `gemma4:31b-cloud` and `gemma4:12b` are different models.
- **The model picker closes the moment you pick a model** (previously it stayed
  open behind the new selection).
- Top bar is now menu, model, conversation title, settings — no effort or usage
  pill competing for space.
- Tighter reading column (720 px), monospace model ids, calmer hover states,
  smaller empty-state heading, phone-width guards for the effort menu.
- Effort is no longer cycled with a click; it is chosen from a menu.
- Local daemon errors are short ("No Ollama daemon answered at …") with a fix
  that points at Find daemon instead of asking for a LAN address.

### Removed

- The `EFFORT_LABELS`-only three-level control and the top-bar effort/usage
  pills.

### Tests

- New `src/core/__tests__/effort.test.ts` pins the level order and wire mapping
  (`reasoning.effort`, `reasoning_effort`, Ollama `think`), the token budget
  rule, namespace stripping, and daemon probe/discovery behaviour including a
  refused connection. Suite: **71/71**.

---

## 2026-11-01 — session 5: owner's icon, real brand logos, slimmer UI

### Added

- **Real vendor logos** for Claude, OpenAI, DeepSeek, Kimi, Gemini, Gemma, Qwen,
  Llama, Mistral, Groq, GLM/Zhipu, Microsoft, NVIDIA, MiniMax, Grok and Ollama.
  They are the official marks, inlined from `@lobehub/icons-static-svg` (MIT) by
  `scripts/make-logos.mjs` into `src/ui/logos.generated.ts`; unknown vendors fall
  back to a neutral letter chip rather than a wrong logo.
- **Local backend drawer**: daemon address with Save/Test, a one-tap
  “Same phone (Termux)” preset, copyable Termux commands
  (`pkg install ollama`, `ollama serve`, `ollama pull treyleo16/claude-oss`) and
  the `OLLAMA_HOST=0.0.0.0:11434` recipe for running Ollama on a computer.
- “Fix connection” button on any daemon/network error, which opens that drawer.
- `npm run icons` and `npm run logos` regenerate the icon set and the logo map.

### Changed

- **The icon is the owner's own artwork** (`assets/icon-source.png`): front-facing
  line-art llama with the eyepatch. Every size is generated from it — launcher,
  round, adaptive foreground, splash, favicon, PWA, Apple touch, desktop — and
  the in-app brand mark now uses the same art.
- **Icons moved out of `build/`**: the repository ignores `build` entries, which
  is why earlier icon files never survived a commit. They now live in `assets/`.
- **Sparser composer**: the row is now model (with logo), effort, mode
  (Agent/Chat) and send. Skill chips moved into the Skills drawer and `/`
  commands; only a “3 skills” hint remains.
- **Context window defaults to 1M tokens**, presets run to 2M; reply cap
  defaults to 4096.
- Top bar no longer shows a token counter; it lives in Usage.

### Fixed

- Cloud-only models are no longer “pulled”: the catalogue hides Pull for them and
  offers “Add to cloud” instead.
- Pull failures that come back as an HTML page (HTTP 403 WAF page) are explained
  as cloud-only or proxy-blocked instead of dumping raw markup.
- Line art stays legible at launcher sizes (alpha lift when downscaling).

---

## 2026-11-01 — session 4: phone layout, menu, logos, effort, parallel models

### Added

- **Left menu** (top-left button): New chat, Sessions, Skills, MCP servers, API
  providers, My models, Terminal CLI, Settings — the same list on phone and
  desktop.
- **Settings drawer**: effort (low/medium/high), history window
  (8K–128K tokens, oldest turns trimmed before sending), max reply, temperature,
  agent mode, failover, model logos, reset usage, clear model cache.
- **Effort control** in the top bar and composer, mapped per wire API:
  `reasoning_effort` (chat completions), `reasoning: {effort}` (responses),
  `think: true` (Ollama native, high only).
- **Parallel models**: the `+` on any model adds it to the run; one send now
  produces one answer per model, streamed concurrently, each with its own
  message, provider and model.
- **Vendor marks** next to model names (Anthropic, OpenAI, DeepSeek, Moonshot,
  Google, Alibaba, Meta, Mistral, xAI, Z.ai, Microsoft, NVIDIA, MiniMax,
  community) — simple geometric glyphs in each brand's colour, not copied
  artwork.
- **Actionable errors** (`core/errors.ts`): HTML/WAF pages detected and quoted as
  text instead of raw `<!doctype html>`, 403 split into "key rejected" vs
  "gateway blocked", local-daemon failures explain that `127.0.0.1` on a phone is
  the phone itself, 400/422 point at the model id or the wire API. Every error
  carries a `fix` line and a failover verdict.
- **Default models**: `treyleo16/claude-oss` (local, 1B) is selected on first
  launch; Ollama Cloud ships with `gemma4:31b-cloud`, `deepseek-v4.1-flash`,
  `glm-5.3`, `muse-spark-open` and `treyleo16/claude-mythos-5-1` in its list.
- **Agent mode on by default**: a plan → act → verify preamble sits ahead of the
  skills.
- Greeting: “Hey! What are you up to today?” with four starter actions.
- `claude-oss` and `gemma4:31b-cloud` added to the catalogue.

### Changed

- **Skills ship enabled** (caveman, REA, OpenRouter).
- **Layout is stable on phones**: `100dvh` instead of `vh` (no jump when the URL
  bar moves), safe-area + native status-bar insets top and bottom, popovers
  become bottom sheets under 860px, the picker no longer hangs off-screen, and
  the thread only auto-scrolls when you are already at the bottom.
- Drawer can open from either side; Escape and backdrop still close it.
- Typography and spacing tightened for small screens (15px composer input so
  iOS does not zoom).

### Fixed

- Icon generator scaled marks by width only, cropping the llama's ears and neck;
  it now fits the mark inside a square box.

---

## 2026-11-01 — session 3: wire APIs, model discovery, catalogue, redesign

### Added

- **Responses wire API** (`openai-responses`): `POST {base}/responses` with
  `instructions` + typed `input` parts, streaming `response.output_text.delta`,
  usage from `response.completed`, errors from `response.failed`. This is the
  mode Codex selects with `wire_api = "responses"` and the one AgentRouter's
  newer models accept.
- **AgentRouter templates**: `AgentRouter` now defaults to the Responses API on
  `https://agentrouter.org/v1`; a second template `AgentRouter (Anthropic wire)`
  uses `https://agentrouter.org` + `/v1/messages`; the OpenAI chat-completions
  mode remains one click away in the provider settings.
- **Provider card controls**: wire-API selector, editable base URL, one-click
  protocol presets from the template, **Test** button, per-key model list, and
  a delete button.
- **Model discovery per key**: fetched models are persisted (`modelsByProvider`),
  loaded automatically when a key is entered, and shown in a searchable model
  picker grouped by provider with context sizes.
- **Ollama catalogue** (`Models`): 51 models snapshotted from
  `https://ollama.com/search` on 2026-11-01, including
  `treyleo16/claude-mythos-5-1`, with search, Local/Cloud and capability
  filters, plus **Pull** (real `/api/pull` progress bars) and **Use**.
- **Pull any model by name** — the daemon accepts any registry reference, so
  the catalogue is a starting point rather than a limit.
- **OpenRouter skill** — the third pre-installed pack (caveman and REA already
  existed); all three are pinned in the Skills drawer and in the composer.
- **Slash commands** in the composer: `/caveman`, `/rea`, `/openrouter`, `/new`,
  `/providers`, `/models`, `/skills`, `/usage`.
- **Model picker popover** in the top bar and composer.
- **Real retry**: a failed answer can be retried; the failed exchange is dropped
  and the same question is resent.
- **Protocol mismatch detection**: 404/400/422 responses that look like a wire
  mismatch are flagged, with a “Switch wire API” action in the error block.
- **App shell smoke test** (`render.test.ts`) rendering the whole tree, so a
  refactor cannot silently produce a blank screen.

### Changed

- **Full UI redesign**, modelled on the Claude Code desktop app: single dark
  neutral surface, hairline borders, sidebar with recents + Providers/Models/
  Skills/Usage, slim top bar with the provider·model pill and usage dot,
  right-aligned user bubbles with plain assistant text, and a rounded composer
  with skill chips, model pill and circular send button.
- **Every panel is a drawer with a visible ✕** (plus Escape and backdrop
  click) — the providers screen previously had no way to close it.
- Cache-busting: model lists now survive a reload instead of being re-fetched
  from scratch.
- Skills are a single global switch per chat; switching a skill mid-conversation
  no longer needs a new thread.

### Removed

- `src/ui/Panels.tsx` — replaced by `ui/Shell.tsx` + `ui/panels/*` (the old
  three-column panel stack and its inline styles).

### Not done

- Temporary mail/phone account generation: **refused, not implemented** — it
  breaks the provider terms of service and gets keys and IPs banned. See the
  note in the PR.

---

## 2026-11-01 — session 2: desktop + Android shells, PNG icon set

### Added

- Electron desktop shell (`electron/main.cjs`, `electron/preload.cjs`): HTTP runs
  in the main process over IPC, so provider CORS rules do not apply; bodies
  stream chunk by chunk and honour abort. Installers via electron-builder
  (AppImage, NSIS, dmg).
- Capacitor Android shell (`capacitor.config.ts`) with `CapacitorHttp` enabled,
  cleartext traffic for a local Ollama daemon, and an APK build script.
- `src/core/transport.ts`: the single place that knows whether requests go
  through the Electron bridge, CapacitorHttp or browser fetch.
- PNG icon set generated from `build/icon-source.png` by
  `scripts/make-icons.py`: desktop, web/PWA/iOS, five Android launcher densities
  (round + adaptive foreground) and a splash image.
- CI builds web, desktop (Linux + Windows) and the Android APK, and verifies the
  APK actually contains the bundle and the PNG icons.

### Changed

- Icon: eyepatch over the left eye with strap, two small angled eyebrows, two
  subtle jawline strokes.
- `vite base` is `./` so `file://` and the Capacitor scheme resolve assets.

### Fixed

- The icon generator sampled the source's white backdrop, which leaked white
  wedges into the rounded corners; it now insets past the tile's corners.
- `android-actions/setup-android@v3` failed on the runner; the Android job now
  uses `sdkmanager` directly.
- Gradle failures now surface as check-run annotations and upload their log.

---

## 2026-11-01 — session 1: milestone 1

### Added

- Chat over three protocols at the time (OpenAI chat-completions, Anthropic
  messages, Ollama native), SSE/NDJSON parsers that survive chunk boundaries.
- Provider templates: Ollama Cloud, local Ollama, AgentRouter, OpenRouter,
  Anthropic, OpenAI, DeepSeek, Kimi, Groq, Gemini, Mistral, custom endpoints.
- Usage ledger with 75% warning and 90% automatic provider switch, plus
  failover on 401/402/403/404/429/5xx/network errors.
- Skills: caveman, REA, planner, reviewer, debugger, spec, token-frugal.
- 51 unit tests, typecheck, production bundle, CI artefact.

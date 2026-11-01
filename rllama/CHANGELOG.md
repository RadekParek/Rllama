# Channel log

Plain-language record of every change, newest first. "Added" = new capability,
"Changed" = existing behaviour altered, "Removed" = something deleted.

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

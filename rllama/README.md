# Rllama

A multi-provider AI workspace for desktop and Android. One interface, your own
keys, no account of ours in the middle.

The app talks to three wire protocols and nothing else:

| Protocol | Endpoint | Used by |
| --- | --- | --- |
| OpenAI-compatible | `POST {base}/chat/completions` | Ollama Cloud, AgentRouter, OpenRouter, DeepSeek, Kimi, Groq, Gemini, Mistral, LM Studio, vLLM |
| Anthropic-compatible | `POST {base}/v1/messages` | Anthropic, AgentRouter (Anthropic mode), Claude-compatible gateways |
| Ollama native | `POST {base}/api/chat` | a local or remote Ollama daemon |

## Base URLs that people get wrong

- **Ollama Cloud** — `https://ollama.com/v1`. The `/api/v1` prefix returns 404.
  Key: <https://ollama.com/settings/keys>.
- **AgentRouter** — `https://agentrouter.org/v1` for OpenAI-compatible clients,
  `https://agentrouter.org` (no `/v1`) for Anthropic-compatible ones. The app
  ships both as one template with a protocol switch.

## What is here now

- Streaming chat for all three protocols, with abort and error surfacing.
- Provider manager: add from a template, paste a key, edit the base URL, switch
  protocol, load the model list from the provider itself.
- Skills: built-in packs (Caveman token compression, REA reverse engineering,
  Planner, Reviewer, Debugger, Spec writer, Token frugal) plus your own
  markdown skills and a base system prompt.
- Usage ledger with budgets per provider: warns at 75 %, and at 90 % continues
  the conversation on the next provider you configured instead of failing.

## What it deliberately does not do

Rllama does **not** create accounts, use disposable emails, or rotate identities
to reset a provider's quota. That is a terms-of-service violation, it gets keys
and IPs banned, and it would make the app useless the moment a provider tightens
signup. The 90 % behaviour is a provider switch, not a quota reset.

## What it does

- **Chat over four wire protocols**: OpenAI chat-completions, OpenAI Responses
  (`/responses`, the `wire_api = "responses"` mode Codex uses), Anthropic
  messages, and Ollama native. One provider card switches between them.
- **Key-only providers**: Ollama Cloud, AgentRouter, OpenRouter, Anthropic,
  OpenAI, DeepSeek, Kimi, Groq, Gemini, Mistral, plus any compatible endpoint.
- **Model discovery**: press “Load models” (or just enter a key) and the models
  that key can actually use appear in the picker, grouped by provider.
- **Ollama catalogue**: 51 models snapshotted from ollama.com/search, searchable
  and filterable, with real `/api/pull` progress; any other model can be pulled
  by name. Pulls only ever go to a local daemon, because Ollama Cloud answers
  `/api/pull` with an HTML 403 page.
- **Skills**: caveman, REA and OpenRouter ship pre-installed (plus planner,
  reviewer, debugger, spec, token-frugal and your own markdown packs), toggleable
  from the composer, the Skills drawer, or `/caveman` style commands.
- **Usage ledger with automatic failover**: warns at 75% of a budget and
  continues on the next provider at 90%, or immediately on 401/402/429/5xx.
- **Effort, six levels**: Minimal, Low, Medium, High, Max and Ultracode, chosen
  from the composer and colour-coded (blue → green → amber → orange → red, with
  an animated gradient for Ultracode). Each level maps onto the provider's own
  controls: `reasoning_effort`, `reasoning: {effort}`, or Ollama's `think` flag.
  Ultracode adds a verify-every-step directive and a larger reply budget.
- **Terminal, wired to a real shell**: on the desktop build the Terminal panel
  streams commands from your shell; on Android it hands them to Termux through
  its RUN_COMMAND service, so Termux and Rllama run side by side and Termux stays
  the backend. `/run <command>` in the composer runs one command and puts its
  output in the conversation, so a question can be answered by the device and
  shown in Rllama.
- **Models from anywhere**: Hugging Face GGUF repositories are pulled straight
  into the daemon (`hf.co/<repo>:<quant>`), and GGUF files already on the phone —
  including models exported from PocketPal — are listed and imported with
  `ollama create` through the same shell bridge.
- **Local Ollama that finds itself**: on start and before every local request the
  app probes the configured address plus the loopback forms (`127.0.0.1`,
  `localhost`, `10.0.2.2`, `[::1]`) and moves to whichever daemon answers, so a
  stale address no longer strands the app, and a real subnet scan (desktop main
  process, or the Android plugin) finds Ollama on another machine. **Local
  backend → Find daemon / Scan network** shows every address it tried and
  switches on tap; **Start Ollama** launches the daemon through the shell or
  Termux instead of asking you to do it.

## Build and run

One codebase, three targets.

```shell
cd rllama
npm install

# web (development)
npm run dev              # http://localhost:5173

# desktop (Electron)
npm run desktop          # build + run the desktop app
npm run desktop:dist     # installers into release/ (AppImage, NSIS, dmg)

# android (Capacitor)
npm run android:sync     # build the bundle and copy it into android/
npm run android:build    # -> android/app/build/outputs/apk/debug/app-debug.apk

npm test                 # unit tests
npm run build            # production bundle in dist/
```

CI (`.github/workflows/rllama.yaml`) builds all three: `rllama-web`,
`rllama-linux`, `rllama-windows` and `rllama-android-apk`.

### Why the shells exist

Browsers block cross-origin requests, and AI gateways rarely send CORS headers.
Each shell solves that once, natively:

| Target | Transport | Key storage |
| --- | --- | --- |
| Desktop (Electron) | IPC to the main process, plain Node `fetch` | OS-level secure storage (next step) |
| Android (Capacitor) | `CapacitorHttp` native stack | app-private storage |
| Web | browser `fetch` (works where the gateway allows CORS) | local storage |

Everything else — providers, skills, usage ledger, failover — is identical.

## Icons

All icons are PNG, generated from the owner's own artwork in
`assets/icon-source.png` by `scripts/make-icons.py` (Pillow):

- `assets/icon.png`, `assets/icon-512.png` — desktop packaging
- `public/icons/*.png` — favicon, PWA, iOS home screen
- `android/app/src/main/res/mipmap-*/ic_launcher*.png` — launcher, round icon and
  adaptive-icon foreground (108dp canvas, mark inside the safe zone)
- `android/app/src/main/res/drawable/splash.png` — launch screen

```shell
python3 -m pip install pillow
npm run icons     # every PNG size from assets/icon-source.png
npm run logos     # inline vendor marks into src/ui/logos.generated.ts
```

Vendor marks come from `@lobehub/icons-static-svg` (MIT) — official brand SVGs,
not redrawn approximations.

## Layout

```
rllama/
├── src/
│   ├── App.tsx            # layout, streaming, failover wiring
│   ├── core/
│   │   ├── providers.ts   # templates, endpoints, auth headers
│   │   ├── client.ts      # streaming chat + model listing per protocol
│   │   ├── sse.ts         # SSE + NDJSON parsers that survive chunk splits
│   │   ├── usage.ts       # ledger, 75/90 % rules, provider choice
│   │   ├── skills.ts      # built-in and custom skill packs
│   │   └── store.ts       # persistence with repair on corrupt data
│   └── ui/                # Markdown, provider/skills/usage panels
└── package.json
```

## Next steps

1. Desktop shell (Electron/Tauri) with OS keychain storage for keys.
2. Android shell reusing this UI, with the local Ollama engine from `../android/`.
3. Model catalog browsing (size, quantisation, licence) and one-click pull.
4. Agent integrations: launch Claude Code / Codex / Hermes with the provider
   config injected, plus an MCP client for tools.

Keys are currently stored in the app's local profile on this device. Before a
public desktop build ships, move them to the OS keychain.

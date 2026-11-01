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

All icons are PNG. `scripts/make-icons.py` (Pillow) derives every size from
`build/icon-source.png`:

- `build/icon.png`, `build/icon-512.png` — desktop packaging
- `public/icons/*.png` — favicon, PWA, iOS home screen
- `android/app/src/main/res/mipmap-*/ic_launcher*.png` — launcher, round icon and
  adaptive-icon foreground (108dp canvas, mark inside the safe zone)
- `android/app/src/main/res/drawable/splash.png` — launch screen

```shell
python3 -m pip install pillow
python3 scripts/make-icons.py
```

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

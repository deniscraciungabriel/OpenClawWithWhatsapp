# OpenClaw — Architecture & Technical Documentation

## Overview

OpenClaw is an open-source AI agent runtime built on Node.js. It acts as a **messaging gateway and tool execution environment** that connects users to a local Large Language Model (LLM) through a web interface, REST API, or messaging channels (Telegram, WhatsApp).

OpenClaw is **not** an LLM itself — it requires an external LLM provider. In this setup, that provider is **Ollama**, running in a sibling Docker container.

**Everything runs inside Docker.** Nothing is installed on the host system beyond Docker itself. Ollama, OpenClaw, models, data — all containerized.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                       │
│                                                         │
│  ┌──────────────────────┐   ┌────────────────────────┐  │
│  │   ollama container   │   │  openclaw-gateway      │  │
│  │                      │   │  container             │  │
│  │   Port: 11434        │◄──│                        │  │
│  │   GPU: passthrough   │   │  Port: 18789           │  │
│  │   Models stored in   │   │  Web UI + REST API     │  │
│  │   Docker volume      │   │  Agent + Tools         │  │
│  └──────────────────────┘   └────────────────────────┘  │
│            ▲                           │                │
│   http://ollama:11434/v1     Exposed to host:          │
│   (Docker internal DNS)      http://localhost:18789     │
│                                                         │
│  Volumes:                                               │
│  ollama-data ──────────► /root/.ollama (models)         │
│  ./data/config ────────► /home/node/.openclaw           │
│  ./data/workspace ─────► /home/node/.openclaw/workspace │
└─────────────────────────────────────────────────────────┘
```

### How the Containers Talk

Both containers sit on the same Docker Compose network. OpenClaw reaches Ollama using the Docker DNS name `ollama` (the service name). No `host.docker.internal`, no host networking, no special tricks — just standard Docker service discovery.

### GPU Passthrough

On Linux, Docker can pass NVIDIA GPUs directly to containers via the **NVIDIA Container Toolkit**. The `docker-compose.yml` reserves all available GPUs for the Ollama container:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

If no GPU is available, the setup script creates a `docker-compose.override.yml` that removes this requirement, and Ollama falls back to CPU inference automatically.

---

## Component Breakdown

### 1. Ollama Container

Uses the official `ollama/ollama:latest` image. Responsible for:

- Hosting and running LLM models
- Exposing an OpenAI-compatible API at port 11434
- Storing downloaded models in a named Docker volume (`ollama-data`)

Models persist across container restarts because they live in a Docker volume, not inside the container's filesystem.

The gateway container has a `depends_on` with `condition: service_healthy`, so it won't start until Ollama is ready.

### 2. Gateway Server (`src/gateway/server.ts`)

An **Express.js HTTP server** that serves as the central entry point for all interactions.

**Responsibilities:**
- Serves the embedded Web UI on `GET /`
- Exposes the REST API under `/api/*`
- Handles authentication via Bearer tokens
- Manages CORS, Helmet security headers, and request logging
- Binds to either `0.0.0.0` (LAN mode) or `127.0.0.1` (loopback mode)

**API Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Returns `{ status: "ok", uptime }` |
| `GET` | `/` | No | Serves the Web UI |
| `POST` | `/api/chat` | Yes | Send a message, receive agent response |
| `POST` | `/api/chat/clear` | Yes | Clear a conversation |
| `GET` | `/api/status` | Yes | System status + LLM connection check |
| `GET` | `/api/models` | Yes | List available Ollama models |
| `GET` | `/api/channels` | Yes | List configured messaging channels |

**Authentication Flow:**
```
Client Request
    │
    ▼
Check Authorization header / query param / body token
    │
    ├── Token matches config ──► Proceed to handler
    │
    └── Token mismatch ──► 401 Unauthorized
```

### 3. Agent (`src/gateway/agent.ts`)

The Agent is the **orchestration layer** between the user, the LLM, and the tools.

**Core Loop:**

```
User sends message
        │
        ▼
┌─── Agent Chat Loop (max 10 iterations) ───┐
│                                             │
│   1. Build message array:                   │
│      [system prompt + memory] + history     │
│      + new user message                     │
│                                             │
│   2. Send to LLM with tool definitions      │
│              │                              │
│              ▼                              │
│   3. LLM responds with either:              │
│      ├── Text response ──► Return to user   │
│      │                                      │
│      └── Tool calls ──► Execute each tool   │
│              │                              │
│              ▼                              │
│   4. Append tool results to messages        │
│   5. Loop back to step 2                    │
│                                             │
└─────────────────────────────────────────────┘
```

**Key behaviors:**
- Each conversation is tracked by a `conversation_id` (UUID)
- The system prompt tells the LLM it's running inside Docker with access to tools
- Memory context from past sessions is injected into the system prompt
- Tool calls are executed sequentially, and results are fed back to the LLM
- The loop caps at 10 iterations to prevent infinite tool-calling cycles

### 4. LLM Provider (`src/llm/ollamaProvider.ts`)

Communicates with the Ollama container via the **OpenAI-compatible API** (`/v1/chat/completions`).

**Request Flow:**
```
Agent
  │
  ▼
OllamaProvider.chat(messages, tools)
  │
  ▼
POST http://ollama:11434/v1/chat/completions
  {
    model: "llama3.2:3b",
    messages: [...],
    tools: [...],
    temperature: 0.7,
    max_tokens: 4096,
    stream: false
  }
  │
  ▼
Parse response → return { content, tool_calls, finish_reason, usage }
```

The provider also supports:
- `testConnection()` — pings the Ollama root endpoint
- `listModels()` — calls `/api/tags` to enumerate downloaded models

### 5. Tools System

Tools give the agent the ability to interact with the system. They are registered with the LLM as function definitions and executed when the LLM returns `tool_calls`.

#### Tool Manager (`src/tools/toolManager.ts`)

Central registry that:
1. Provides tool definitions to the LLM (JSON Schema format)
2. Routes tool calls to the correct handler
3. Returns string results back to the agent loop

#### Bash Tool (`src/tools/bashTool.ts`)

Executes shell commands inside the OpenClaw container.

```
Command → Validate (allowed/denied lists) → exec() → { stdout, stderr, exitCode, timedOut }
```

- Configurable timeout (default: 30s)
- Optional allowlist/denylist of commands
- Runs in the workspace directory by default
- Capped at 10MB output buffer

#### File Tool (`src/tools/fileTool.ts`)

File system operations scoped to the workspace.

- `readFile(path)` — Read file contents
- `writeFile(path, content)` — Create/overwrite files (auto-creates directories)
- `listDirectory(path)` — List directory contents
- `deleteFile(path)` — Remove a file
- `fileExists(path)` / `getFileInfo(path)` — Stat operations

Relative paths resolve against the workspace directory. Absolute paths are used as-is.

#### Browser Tool (`src/tools/browserTool.ts`)

Headless web browsing via **Playwright + Chromium**.

```
URL → Launch Chromium (headless) → Navigate → Extract text content → Return { title, content, status }
```

- Strips `<script>`, `<style>`, `<noscript>` tags before extracting text
- Content capped at 50,000 characters
- Browser instance is reused across calls for performance
- Runs with `--no-sandbox` inside the container

### 6. Memory System (`src/memory/memoryManager.ts`)

A persistent key-value store that survives container restarts (stored on the mounted volume).

```
./data/config/memory/store.json
```

**Structure:**
```json
[
  {
    "id": "mem_1708000000000_abc123",
    "key": "user_preference",
    "value": "Prefers concise answers",
    "timestamp": 1708000000000
  }
]
```

- The agent can set/get/delete/search memories
- On conversation start, the last 20 memory entries are injected into the system prompt
- Backed by a JSON file on disk (loaded into memory on startup)

### 7. Channel Manager (`src/channels/channelManager.ts`)

Abstraction layer for external messaging platforms (Telegram, WhatsApp, etc.).

- Provides a `Channel` interface with `start()`, `stop()`, `send()`, `isConnected()`
- A `MessageHandler` callback routes incoming messages through the Agent
- Channels are configured in `openclaw.json` and managed via the CLI

### 8. CLI (`src/cli.ts`)

Management tool for the container, built with **Commander.js**.

| Command | Description |
|---------|-------------|
| `status` | Show gateway, LLM, and tools status |
| `health` | Run health check (exits 0/1) |
| `models [status]` | Show current model + list available models |
| `channels [list\|add\|remove]` | Manage messaging channels |
| `config [show\|path]` | Display config (token masked) or config file path |
| `logs` | Hint to use `docker compose logs` |

Invoked via Docker Compose:
```bash
docker compose run --rm openclaw-cli status
```

### 9. Configuration (`src/config/configManager.ts`)

Configuration is loaded from three possible locations (first found wins):

1. `/home/node/.openclaw/openclaw.json` (inside container, from mounted volume)
2. `./openclaw.json` (current working directory)
3. `~/.openclaw/openclaw.json` (user home)

Environment variables override file values:
- `OPENCLAW_GATEWAY_TOKEN` → `gateway.auth.token`
- `OPENCLAW_GATEWAY_BIND` → `gateway.bind`
- `OPENCLAW_GATEWAY_PORT` → `gateway.port`

Deep merging ensures partial configs work — you only need to specify what you want to change.

---

## Docker Architecture

### Dockerfile (OpenClaw)

```
Base: node:20-slim
  │
  ├── Install system deps (Playwright/Chromium requirements)
  ├── Create non-root "node" user
  ├── npm install (dependencies)
  ├── npx playwright install chromium
  ├── Copy source & build TypeScript
  ├── Create /home/node/.openclaw directories
  ├── Switch to non-root user
  ├── EXPOSE 18789
  ├── HEALTHCHECK (curl /health every 30s)
  └── CMD: node dist/index.js
```

### Docker Compose Services

**`ollama`** (LLM engine):
- Uses official `ollama/ollama:latest` image
- Reserves NVIDIA GPUs (if available)
- Stores models in `ollama-data` named volume
- Health check on `/` endpoint
- Exposes port 11434 to host (for debugging)

**`openclaw-gateway`** (main service):
- Builds from the Dockerfile
- Waits for Ollama to be healthy before starting
- Maps port 18789 to host
- Mounts `./data/config` and `./data/workspace` as volumes
- Passes env vars from `.env`
- Has a health check, restarts unless stopped

**`openclaw-cli`** (management, profile: cli):
- Same image, same volumes
- Overrides entrypoint to `node dist/cli.js`
- Only runs on demand with `docker compose run --rm openclaw-cli <command>`

### Volume Mapping

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./data/config/` | `/home/node/.openclaw/` | Config, memory, logs |
| `./data/workspace/` | `/home/node/.openclaw/workspace/` | Agent working files |
| `ollama-data` (named) | `/root/.ollama/` | Downloaded LLM models |

All data persists across container restarts and rebuilds.

---

## Request Lifecycle (End-to-End)

Here's what happens when a user sends "Create a file called hello.txt with Hello World":

```
1. Browser → POST http://localhost:18789/api/chat { message: "Create a file..." }
                    │
2. Server authenticates Bearer token
                    │
3. Agent.chat() called with conversation ID
                    │
4. Builds messages: [system_prompt, user_message]
                    │
5. Sends to Ollama container: POST http://ollama:11434/v1/chat/completions
                    │
6. Ollama returns tool_call: { name: "write_file", args: { path: "hello.txt", content: "Hello World" } }
                    │
7. Agent executes: ToolManager.executeTool("write_file", {...})
                    │
8. FileTool writes /home/node/.openclaw/workspace/hello.txt
                    │
9. Result "File written successfully" appended to messages
                    │
10. Sends updated messages back to Ollama
                    │
11. Ollama returns: "I've created hello.txt with 'Hello World' in your workspace."
                    │
12. Response returned to browser via JSON: { response: "...", conversation_id: "..." }
```

On the host, the file appears at `./data/workspace/hello.txt` because of the volume mount.

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **Network** | Gateway bind mode: `lan` (all interfaces) or `loopback` (localhost only) |
| **Authentication** | Bearer token required for all `/api/*` endpoints |
| **Container isolation** | Non-root user, Docker namespace isolation, no host mounts beyond data dirs |
| **Tool sandboxing** | Bash allowed/denied command lists, configurable timeouts |
| **Volume isolation** | Only `./data/` is accessible from containers |
| **LLM privacy** | All data stays local — Ollama runs in a container, no external API calls |
| **No host installs** | Nothing runs on the host, everything is containerized |

---

## File Structure

```
OpenClaw/                            # Project root
├── Dockerfile                       # OpenClaw image definition
├── docker-compose.yml               # All services (ollama + gateway + cli)
├── docker-compose.override.yml      # Auto-generated: CPU-only fallback (if no GPU)
├── docker-setup.sh                  # Interactive setup wizard
├── package.json                     # Node.js dependencies
├── tsconfig.json                    # TypeScript configuration
├── .env.example                     # Environment variable template
├── .env                             # Actual env vars (gitignored)
├── .dockerignore                    # Docker build exclusions
├── .gitignore                       # Git exclusions
├── src/                             # TypeScript source
│   ├── index.ts                     # Main entry point
│   ├── cli.ts                       # CLI management tool
│   ├── health.ts                    # Standalone health check
│   ├── config/
│   │   └── configManager.ts         # Config loading & merging
│   ├── gateway/
│   │   ├── server.ts                # Express HTTP server + Web UI
│   │   └── agent.ts                 # Agent orchestration loop
│   ├── llm/
│   │   └── ollamaProvider.ts        # Ollama API client
│   ├── tools/
│   │   ├── toolManager.ts           # Tool registry & router
│   │   ├── bashTool.ts              # Shell command execution
│   │   ├── fileTool.ts              # File system operations
│   │   └── browserTool.ts           # Headless Chromium browsing
│   ├── memory/
│   │   └── memoryManager.ts         # Persistent key-value memory
│   ├── channels/
│   │   └── channelManager.ts        # Messaging platform abstraction
│   └── utils/
│       ├── logger.ts                # Structured logging
│       └── health.ts                # Health check logic
├── dist/                            # Compiled JavaScript (build output)
└── data/                            # Persistent data (mounted into containers)
    ├── config/
    │   ├── openclaw.json            # Main configuration file
    │   ├── memory/
    │   │   └── store.json           # Persistent memory entries
    │   └── logs/                    # Application logs
    └── workspace/
        ├── files/                   # Files created by agent
        └── downloads/               # Downloaded content
```

# OpenClaw

A self-hosted AI agent runtime that runs entirely in Docker. Connect a local LLM (via Ollama) to messaging channels, give it tools (shell, browser, files, Claude Code), and let it work autonomously — all on your own hardware.

## Features

- **Local LLM** — Uses Ollama with any compatible model. No data leaves your machine.
- **Tool Use** — The agent can execute shell commands, browse the web (visible Chromium), and read/write files.
- **Claude Code Integration** — Delegates coding tasks to Claude Code running on your host machine via SSH.
- **Persistent Memory** — Key-value store injected into the system prompt so the agent remembers across conversations.
- **Messaging Channels** — WhatsApp integration (via Baileys). Channels can be started/stopped individually via API.
- **Web UI & REST API** — Chat with the agent from your browser or integrate via HTTP.
- **CLI** — Manage status, models, channels, and config from the terminal.
- **Fully Containerized** — One `docker compose up` and everything runs.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- (Optional) A GPU for faster inference

### 1. Clone and configure

```bash
git clone <repo-url> && cd OpenClaw
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
OPENCLAW_GATEWAY_TOKEN=some_secure_token
HOST_USER=your_linux_username
HOST_HOME_DIR=/home/your_linux_username
```

Or run the interactive setup:

```bash
bash docker-setup.sh
```

### 2. Build and start

```bash
docker compose up -d --build
```

This starts **Ollama** (LLM server) and **OpenClaw Gateway** (agent + API + web UI).

### 3. Use

- **Web UI**: Open `http://localhost:18789` in your browser
- **REST API**:
  ```bash
  curl -X POST http://localhost:18789/api/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
    -d '{"message": "Hello"}'
  ```
- **CLI**:
  ```bash
  docker compose run --rm openclaw-cli status
  docker compose run --rm openclaw-cli models
  ```

## Post-Install Setup

After your first `docker compose up`, there are a few one-time setup steps for optional features.

### Browser tool (visible Chromium on your desktop)

The agent can open a real browser window on your screen. This requires X11 forwarding from the container:

```bash
# Allow Docker containers to access your display (run on host, once per reboot)
export DISPLAY=:0
xhost +local:docker
```

To make it permanent, add to your `~/.bashrc`:

```bash
echo 'export DISPLAY=:0' >> ~/.bashrc
```

The browser is configured with `"headless": false` in `data/config/openclaw.json`. Set it to `true` if you prefer invisible background browsing.

### Claude Code tool (AI coding via SSH)

The agent delegates coding tasks to [Claude Code](https://claude.ai/claude-code) running on your host. This requires SSH access from the container back to your machine.

**1. Make sure SSH is running on your host:**

```bash
sudo systemctl enable --now ssh
```

**2. Authorize the container's SSH key:**

On first start, the container auto-generates an SSH key. Find it in the logs:

```bash
docker logs openclaw-gateway 2>&1 | grep "echo '"
```

You'll see a line like:

```
echo 'ssh-ed25519 AAAA...openclaw-agent' >> ~/.ssh/authorized_keys
```

Run that line on your host. This is a one-time step — the key persists in `data/config/ssh/`.

**3. Verify it works:**

Ask the agent to code something (via Web UI or API). It should SSH to your host and invoke `claude` directly.

If it fails, check that:
- SSH server is running: `systemctl status ssh`
- Your user can SSH to localhost: `ssh localhost whoami`
- The key is in `~/.ssh/authorized_keys`

### WhatsApp channel

WhatsApp is configured with `"autoStart": false` by default, so it won't connect on every container restart. You control it manually via API.

**1. Start the channel:**

```bash
curl -X POST http://localhost:18789/api/channels/whatsapp/start \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

**2. Scan the QR code:**

A QR code will appear in the container logs:

```bash
docker logs -f openclaw-gateway
```

Scan it with WhatsApp on your phone (Linked Devices > Link a Device).

**3. Done.** Subsequent starts reuse the saved session in `data/config/whatsapp-auth/`. To stop:

```bash
curl -X POST http://localhost:18789/api/channels/whatsapp/stop \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

## Channel Management

```bash
TOKEN="your_gateway_token"

# List channels and their status
curl http://localhost:18789/api/channels -H "Authorization: Bearer $TOKEN"

# Start a channel
curl -X POST http://localhost:18789/api/channels/whatsapp/start \
  -H "Authorization: Bearer $TOKEN"

# Stop a channel
curl -X POST http://localhost:18789/api/channels/whatsapp/stop \
  -H "Authorization: Bearer $TOKEN"
```

Channels with `"autoStart": true` (the default) connect automatically on boot. Set `"autoStart": false` in `data/config/openclaw.json` for manual control.

## API Reference

All protected endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (public) |
| `GET` | `/` | Web UI (public) |
| `POST` | `/api/chat` | Send a message to the agent |
| `POST` | `/api/chat/clear` | Clear a conversation |
| `GET` | `/api/status` | Agent and LLM status |
| `GET` | `/api/models` | List available Ollama models |
| `GET` | `/api/channels` | List channels and status |
| `POST` | `/api/channels/:name/start` | Start a channel |
| `POST` | `/api/channels/:name/stop` | Stop a channel |

## Configuration

Configuration is loaded from `data/config/openclaw.json` and can be overridden with environment variables in `.env`.

| Env Variable | Description | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Auth token for API access | _(none)_ |
| `OPENCLAW_GATEWAY_BIND` | `lan` (0.0.0.0) or `loopback` (127.0.0.1) | `lan` |
| `OPENCLAW_GATEWAY_PORT` | Gateway port | `18789` |
| `OLLAMA_BASE_URL` | Ollama API URL | `http://ollama:11434/v1` |
| `OLLAMA_MODEL` | Default model | _(from config)_ |
| `HOST_USER` | Your Linux username (for SSH-based Claude Code tool) | `utente` |
| `HOST_HOME_DIR` | Host directory mounted into the container at `/host-home` | `/home` |

## Project Structure

```
src/
  index.ts              # Entry point
  cli.ts                # CLI management tool
  gateway/
    server.ts           # Express server, routes, web UI
    agent.ts            # LLM agent loop with tool orchestration
  llm/
    ollamaProvider.ts   # Ollama API client
  tools/
    toolManager.ts      # Tool registry
    bashTool.ts         # Shell command execution
    fileTool.ts         # File read/write/delete
    browserTool.ts      # Visible web browsing (Playwright)
    claudeCodeTool.ts   # Claude Code via SSH to host
  channels/
    channelManager.ts   # Channel abstraction + start/stop control
    whatsappChannel.ts  # WhatsApp via Baileys
  memory/
    memoryManager.ts    # Persistent key-value memory
  config/
    configManager.ts    # Config loading and merging
```

## Further Reading

- [Architecture](ARCHITECTURE.md) — System design, component breakdown, request lifecycle
- [Guide](GUIDE.md) — Detailed setup, operations, troubleshooting, and backup

## License

See [LICENSE](LICENSE) for details.

# OpenClaw — Getting Started Guide

You've received a complete OpenClaw project. This guide walks you through everything you need to set it up and start using it.

---

## What You Have

OpenClaw is a **local AI assistant** that runs entirely in Docker. You talk to it through a web browser (or API), and it uses a local LLM (Ollama) to respond. It can also:

- Execute shell commands
- Read and write files
- Browse websites
- Remember things across conversations

**Everything runs inside Docker containers.** You don't need to install Ollama, Node.js, or anything else on your machine — just Docker.

---

## The Only Prerequisite: Docker

You need Docker Engine with the Compose plugin installed. That's it.

### Install Docker Engine (if you don't have it)

Follow the official guide for your distro:

- **Ubuntu/Debian:** `sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin`
- **Fedora:** `sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin`
- **Arch:** `sudo pacman -S docker docker-compose`

Or see: https://docs.docker.com/engine/install/

After installing:
```bash
# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Let your user run Docker without sudo (log out and back in after this)
sudo usermod -aG docker $USER
```

Verify:
```bash
docker --version
docker compose version
```

### Optional: NVIDIA GPU Support

If you have an NVIDIA GPU and want faster AI responses, install the NVIDIA Container Toolkit:

https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html

The setup script auto-detects your GPU. If it's not found, everything still works — just on CPU (slower but perfectly functional).

---

## Setup

### The Quick Way (Recommended)

```bash
cd /path/to/OpenClaw

chmod +x docker-setup.sh
./docker-setup.sh
```

The script will:
1. Check that Docker is installed and running
2. Detect whether you have a GPU
3. Create data directories inside the project folder
4. Generate a secure authentication token
5. Ask you a few questions (gateway mode, which model)
6. Build the OpenClaw Docker image
7. Start Ollama + OpenClaw containers
8. Download your chosen AI model inside the Ollama container

At the end, it prints your **gateway token** — save it, you need it to log in.

Then open **http://localhost:18789** in your browser.

### The Manual Way

If you prefer to do it step by step:

#### 1. Create the environment file

```bash
cp .env.example .env
```

Edit `.env`:
```env
OPENCLAW_IMAGE=openclaw:local
OPENCLAW_CONFIG_DIR=./data/config
OPENCLAW_WORKSPACE_DIR=./data/workspace
OPENCLAW_GATEWAY_TOKEN=put_a_strong_random_string_here
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_BRIDGE_PORT=18790
OLLAMA_PORT=11434
OLLAMA_MODEL=llama3.2:3b
```

Generate a token:
```bash
openssl rand -base64 32
```

#### 2. Create data directories

```bash
mkdir -p data/config/memory data/config/logs
mkdir -p data/workspace/files data/workspace/downloads
```

#### 3. Create the config file

Create `data/config/openclaw.json`:

```json
{
  "gateway": {
    "bind": "lan",
    "port": 18789,
    "auth": {
      "token": "same_token_as_in_env_file"
    }
  },
  "llm": {
    "provider": "ollama",
    "baseURL": "http://ollama:11434/v1",
    "model": "llama3.2:3b",
    "temperature": 0.7,
    "maxTokens": 4096,
    "input": "text"
  },
  "tools": {
    "bash": { "enabled": true, "timeout": 30000 },
    "browser": { "enabled": true, "headless": true, "timeout": 30000 },
    "file": { "enabled": true }
  },
  "channels": [],
  "memory": { "enabled": true, "type": "local" }
}
```

> **Important:** The `baseURL` must be `http://ollama:11434/v1` — this is the Docker service name. Both containers share a Docker network, so they can reach each other by name.

#### 4. Handle GPU (if you don't have one)

If you **don't** have an NVIDIA GPU, create this file to disable the GPU requirement:

```bash
cat > docker-compose.override.yml << 'EOF'
version: "3.8"
services:
  ollama:
    deploy: {}
EOF
```

If you **do** have a GPU, skip this step.

#### 5. Build and start

```bash
docker compose up -d --build
```

#### 6. Pull a model

```bash
docker compose exec ollama ollama pull llama3.2:3b
```

#### 7. Open the web UI

Go to **http://localhost:18789** and enter your token.

---

## Using OpenClaw

### Web Interface

1. Go to http://localhost:18789
2. Enter your gateway token
3. Start chatting

**Try these to test everything works:**

| What to Type | What Should Happen |
|-------------|-------------------|
| "What is 2 + 2?" | Responds with "4" |
| "What operating system are you running on?" | Runs `uname -a`, reports Linux (the container OS) |
| "Create a file called hello.txt with Hello World" | File appears in `./data/workspace/` |
| "Go to example.com and tell me the page title" | Uses the browser tool to visit the site |

### REST API

You can also interact programmatically:

```bash
TOKEN="your_token_here"

# Send a message
curl -X POST http://localhost:18789/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "What is 2 + 2?"}'

# Check status
curl http://localhost:18789/api/status \
  -H "Authorization: Bearer $TOKEN"

# List models
curl http://localhost:18789/api/models \
  -H "Authorization: Bearer $TOKEN"

# Clear a conversation
curl -X POST http://localhost:18789/api/chat/clear \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"conversation_id": "your-conversation-id"}'
```

### CLI Management

```bash
# Check OpenClaw status
docker compose run --rm openclaw-cli status

# Health check
docker compose run --rm openclaw-cli health

# List models
docker compose run --rm openclaw-cli models status

# Show config (token is masked)
docker compose run --rm openclaw-cli config show

# List channels
docker compose run --rm openclaw-cli channels list
```

---

## Managing Models

Models live inside the Ollama container's Docker volume. They persist across restarts.

```bash
# Pull a new model
docker compose exec ollama ollama pull phi3:mini

# List downloaded models
docker compose exec ollama ollama list

# Remove a model
docker compose exec ollama ollama rm llama3.2:3b

# Test a model directly
docker compose exec ollama ollama run llama3.2:3b "Hello"
```

### Switching the Active Model

1. Edit `data/config/openclaw.json` — change `"model"`:
   ```json
   { "llm": { "model": "phi3:mini" } }
   ```

2. Restart the gateway:
   ```bash
   docker compose restart openclaw-gateway
   ```

### Recommended Models

| Priority | Model | Why |
|----------|-------|-----|
| Speed | `phi3:mini` | Fastest responses, lowest memory |
| Balance | `llama3.2:3b` | Best quality/speed ratio |
| Quality | `mistral:7b` | Best for complex tasks and coding |
| Efficiency | `gemma:2b` | Good performance, minimal resources |

---

## Day-to-Day Operations

### Starting and Stopping

```bash
# Start everything (Ollama + OpenClaw)
docker compose up -d

# Stop everything
docker compose stop

# Restart everything
docker compose restart

# Stop and remove containers (data volumes are kept)
docker compose down

# Stop and remove EVERYTHING including model data
docker compose down -v
```

### Viewing Logs

```bash
# All services, live
docker compose logs -f

# Just OpenClaw gateway
docker compose logs -f openclaw-gateway

# Just Ollama
docker compose logs -f ollama

# Last 100 lines
docker compose logs --tail=100

# Save to file
docker compose logs > openclaw-logs.txt
```

### Monitoring

```bash
# Container resource usage
docker stats

# Check container status
docker compose ps
```

---

## Updating

### Update OpenClaw (if you get new source code)

```bash
docker compose down
docker compose up -d --build
```

Your config and workspace data are safe — they're in `./data/` which is not inside the container.

### Update Ollama

```bash
docker compose pull ollama
docker compose up -d ollama
```

Your downloaded models are safe — they're in a named Docker volume.

---

## Security Hardening

### Restrict to Localhost Only

In `data/config/openclaw.json`:
```json
{ "gateway": { "bind": "loopback" } }
```

Restart. Now only accessible from `http://localhost:18789`, not from other machines.

### Use a Strong Token

```bash
openssl rand -base64 48
```

Update both `.env` (`OPENCLAW_GATEWAY_TOKEN`) and `data/config/openclaw.json` (`gateway.auth.token`) with the same value, then restart.

### Limit Bash Commands

In `data/config/openclaw.json`:

```json
{
  "tools": {
    "bash": {
      "enabled": true,
      "timeout": 10000,
      "allowedCommands": ["ls", "cat", "pwd", "echo", "python3"],
      "deniedCommands": ["rm", "sudo", "curl", "wget"]
    }
  }
}
```

### Disable Tools Entirely

```json
{
  "tools": {
    "bash": { "enabled": false },
    "browser": { "enabled": false },
    "file": { "enabled": true }
  }
}
```

### Read-Only Workspace

In `docker-compose.yml`, add `:ro` to the workspace volume:

```yaml
volumes:
  - ${OPENCLAW_WORKSPACE_DIR:-./data/workspace}:/home/node/.openclaw/workspace:ro
```

---

## Backup and Restore

### Backup

All your data is in `./data/` and the `ollama-data` Docker volume:

```bash
# Backup config + workspace
cp -r ./data ./data-backup-$(date +%Y%m%d)

# Backup Ollama models (optional, they can be re-pulled)
docker run --rm -v ollama-data:/source -v $(pwd):/backup alpine \
  tar czf /backup/ollama-models-$(date +%Y%m%d).tar.gz -C /source .
```

### Restore

```bash
docker compose down

# Restore config + workspace
cp -r ./data-backup-20260217 ./data

# Restore Ollama models (optional)
docker run --rm -v ollama-data:/target -v $(pwd):/backup alpine \
  tar xzf /backup/ollama-models-20260217.tar.gz -C /target

docker compose up -d
```

---

## Troubleshooting

### "Cannot connect to Ollama"

Check the Ollama container is running and healthy:
```bash
docker compose ps
docker compose logs ollama
```

Test the connection from the gateway container:
```bash
docker compose exec openclaw-gateway curl http://ollama:11434/
# Should print: "Ollama is running"
```

If Ollama keeps restarting, it might be a GPU driver issue. Try CPU-only mode:
```bash
cat > docker-compose.override.yml << 'EOF'
version: "3.8"
services:
  ollama:
    deploy: {}
EOF
docker compose up -d
```

### "Container won't start" / "Port already in use"

```bash
# Check what's using the port
sudo lsof -i :18789

# Change port in .env
OPENCLAW_GATEWAY_PORT=18790

# Or clean up old containers
docker compose down
docker system prune
```

### "Out of memory"

1. Switch to a smaller model: `docker compose exec ollama ollama pull gemma:2b`
2. Set `"input": "text"` (not `"multimodal"`) in config
3. Close other apps
4. Use a model with fewer parameters

### "Permission denied" on data directory

```bash
chmod -R 755 ./data
# If using Docker as root:
sudo chown -R 1000:1000 ./data
```

### Token not working

Verify the token matches in both files:
```bash
grep OPENCLAW_GATEWAY_TOKEN .env
cat data/config/openclaw.json | grep token
```

They must be identical. Restart after changes:
```bash
docker compose restart openclaw-gateway
```

### Ollama is slow (no GPU)

Check if GPU is being used:
```bash
docker compose exec ollama ollama ps
# Look for the "processor" column — should say "GPU" not "CPU"
```

If it says CPU, you need the NVIDIA Container Toolkit:
https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html

Then recreate the containers:
```bash
rm -f docker-compose.override.yml
docker compose down
docker compose up -d
```

---

## Quick Reference

### Most Common Commands

```bash
# Start everything
docker compose up -d

# Stop everything
docker compose stop

# Restart everything
docker compose restart

# View logs (live)
docker compose logs -f

# Check status
docker compose ps

# Pull a new model
docker compose exec ollama ollama pull <model-name>

# List models
docker compose exec ollama ollama list

# OpenClaw status
docker compose run --rm openclaw-cli status

# Rebuild after code changes
docker compose up -d --build

# Full teardown (keeps data)
docker compose down

# Nuclear teardown (deletes model data too)
docker compose down -v
```

### Important Paths

| What | Where |
|------|-------|
| Web UI | http://localhost:18789 |
| Config file | `./data/config/openclaw.json` |
| Memory store | `./data/config/memory/store.json` |
| Workspace (files agent creates) | `./data/workspace/` |
| Environment variables | `.env` |
| Ollama models | `ollama-data` Docker volume |
| Logs | `docker compose logs` |

### What Gets Preserved Across Restarts

| What | How | Survives `down`? | Survives `down -v`? |
|------|-----|:-:|:-:|
| Config + memory | `./data/config/` mount | Yes | Yes |
| Workspace files | `./data/workspace/` mount | Yes | Yes |
| Downloaded models | `ollama-data` volume | Yes | **No** |
| Conversation history | In-memory only | No | No |

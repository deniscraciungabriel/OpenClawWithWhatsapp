#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "  ___                    ____ _                 "
echo " / _ \ _ __   ___ _ __  / ___| | __ ___      __ "
echo "| | | | '_ \ / _ \ '_ \| |   | |/ _\` \ \ /\ / / "
echo "| |_| | |_) |  __/ | | | |___| | (_| |\ V  V /  "
echo " \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/   "
echo "      |_|                                        "
echo -e "${NC}"
echo -e "${CYAN}Docker Setup Script v1.0 (Linux — Fully Dockerized)${NC}"
echo "======================================================="
echo ""
echo "This will set up OpenClaw + Ollama entirely inside Docker."
echo "Nothing is installed on your host system."
echo ""

# ─── Step 1: Prerequisites ──────────────────────────────────

echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
    echo "Install Docker Engine: https://docs.docker.com/engine/install/"
    exit 1
fi
echo -e "  ${GREEN}✓ Docker found: $(docker --version)${NC}"

if ! docker info &> /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Start it with: sudo systemctl start docker"
    exit 1
fi
echo -e "  ${GREEN}✓ Docker daemon is running${NC}"

if ! docker compose version &> /dev/null 2>&1; then
    echo -e "${RED}Error: Docker Compose is not available${NC}"
    echo "Install the docker-compose-plugin package for your distro."
    exit 1
fi
echo -e "  ${GREEN}✓ Docker Compose available${NC}"

# Check for NVIDIA GPU support (optional)
HAS_GPU=false
if command -v nvidia-smi &> /dev/null 2>&1; then
    if nvidia-smi &> /dev/null 2>&1; then
        HAS_GPU=true
        echo -e "  ${GREEN}✓ NVIDIA GPU detected${NC}"
        if docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi &> /dev/null 2>&1; then
            echo -e "  ${GREEN}✓ NVIDIA Container Toolkit working${NC}"
        else
            HAS_GPU=false
            echo -e "  ${YELLOW}⚠ NVIDIA GPU found but Container Toolkit not working${NC}"
            echo -e "  ${YELLOW}  Ollama will run on CPU. For GPU support install:${NC}"
            echo -e "  ${YELLOW}  https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html${NC}"
        fi
    fi
else
    echo -e "  ${YELLOW}⚠ No NVIDIA GPU detected — Ollama will use CPU (slower but works fine)${NC}"
fi

# ─── Step 2: Directories ────────────────────────────────────

echo ""
echo -e "${YELLOW}[2/7] Creating data directories...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"

mkdir -p "${DATA_DIR}/config/memory"
mkdir -p "${DATA_DIR}/config/logs"
mkdir -p "${DATA_DIR}/workspace/files"
mkdir -p "${DATA_DIR}/workspace/downloads"

echo -e "  ${GREEN}✓ Config:    ${DATA_DIR}/config/${NC}"
echo -e "  ${GREEN}✓ Workspace: ${DATA_DIR}/workspace/${NC}"

# ─── Step 3: Environment ────────────────────────────────────

echo ""
echo -e "${YELLOW}[3/7] Setting up environment...${NC}"

if [ ! -f "${SCRIPT_DIR}/.env" ]; then
    cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"

    # Generate a secure random token
    TOKEN=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
    sed -i "s/your_secure_token_here_change_this/${TOKEN}/" "${SCRIPT_DIR}/.env"

    echo -e "  ${GREEN}✓ Created .env file${NC}"
    echo -e "  ${GREEN}✓ Generated secure gateway token${NC}"
    echo ""
    echo -e "  ${CYAN}Your gateway token: ${TOKEN}${NC}"
    echo -e "  ${YELLOW}  Save this! You need it to log in.${NC}"
else
    echo -e "  ${GREEN}✓ .env file already exists, keeping it${NC}"
    TOKEN=$(grep OPENCLAW_GATEWAY_TOKEN "${SCRIPT_DIR}/.env" | cut -d'=' -f2)
fi

# ─── Step 4: Configuration ──────────────────────────────────

echo ""
echo -e "${YELLOW}[4/7] Configuring OpenClaw...${NC}"

# Gateway mode
echo ""
echo -e "  ${CYAN}Gateway mode:${NC}"
echo "    1) lan       — Accessible from your local network (default)"
echo "    2) loopback  — Localhost only (more secure)"
read -p "  Select [1]: " BIND_CHOICE
BIND_CHOICE=${BIND_CHOICE:-1}
if [ "$BIND_CHOICE" = "2" ]; then
    GATEWAY_BIND="loopback"
else
    GATEWAY_BIND="lan"
fi

# Model name
echo ""
echo -e "  ${CYAN}Which model to download?${NC}"
echo "    Recommended:"
echo "      1) llama3.2:3b   — General purpose, best quality/size (default)"
echo "      2) phi3:mini     — Fastest, good for coding"
echo "      3) gemma:2b      — Fast, efficient"
echo "      4) mistral:7b    — Best quality, needs more RAM"
echo "      5) Custom        — Enter a model name"
read -p "  Select [1]: " MODEL_CHOICE
MODEL_CHOICE=${MODEL_CHOICE:-1}

case $MODEL_CHOICE in
    2) MODEL_NAME="phi3:mini" ;;
    3) MODEL_NAME="gemma:2b" ;;
    4) MODEL_NAME="mistral:7b" ;;
    5)
        read -p "  Enter model name: " MODEL_NAME
        MODEL_NAME=${MODEL_NAME:-"llama3.2:3b"}
        ;;
    *) MODEL_NAME="llama3.2:3b" ;;
esac

# Update .env with chosen model
sed -i "s/^OLLAMA_MODEL=.*/OLLAMA_MODEL=${MODEL_NAME}/" "${SCRIPT_DIR}/.env"

# Write openclaw.json
cat > "${DATA_DIR}/config/openclaw.json" << CONFIGEOF
{
  "gateway": {
    "bind": "${GATEWAY_BIND}",
    "port": 18789,
    "auth": {
      "token": "${TOKEN}"
    }
  },
  "llm": {
    "provider": "ollama",
    "baseURL": "http://ollama:11434/v1",
    "model": "${MODEL_NAME}",
    "temperature": 0.7,
    "maxTokens": 4096,
    "input": "text"
  },
  "tools": {
    "bash": {
      "enabled": true,
      "timeout": 30000
    },
    "browser": {
      "enabled": true,
      "headless": true,
      "timeout": 30000
    },
    "file": {
      "enabled": true
    }
  },
  "channels": [],
  "memory": {
    "enabled": true,
    "type": "local"
  }
}
CONFIGEOF

echo ""
echo -e "  ${GREEN}✓ Config saved${NC}"

# ─── Step 5: Handle GPU compose override ────────────────────

echo ""
echo -e "${YELLOW}[5/7] Preparing Docker Compose...${NC}"

if [ "$HAS_GPU" = true ]; then
    # Enable GPU passthrough by using the GPU override
    cp "${SCRIPT_DIR}/docker-compose.gpu.yml" "${SCRIPT_DIR}/docker-compose.override.yml"
    echo -e "  ${GREEN}✓ GPU mode enabled (NVIDIA passthrough)${NC}"
else
    # Ensure no GPU override is active
    rm -f "${SCRIPT_DIR}/docker-compose.override.yml"
    echo -e "  ${GREEN}✓ CPU-only mode${NC}"
fi

# ─── Step 6: Build and start ────────────────────────────────

echo ""
echo -e "${YELLOW}[6/7] Building and starting containers...${NC}"
echo "  This may take a few minutes on first run..."
echo ""

docker compose up -d --build

# Wait for Ollama to be healthy
echo ""
echo -e "  Waiting for Ollama to start..."
ATTEMPTS=0
MAX_ATTEMPTS=30
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    if curl -sf http://localhost:11434/ > /dev/null 2>&1; then
        break
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    sleep 2
done

if [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; then
    echo -e "  ${RED}Ollama didn't start in time. Check logs:${NC}"
    echo "    docker compose logs ollama"
    exit 1
fi
echo -e "  ${GREEN}✓ Ollama is running${NC}"

# ─── Step 7: Pull the model ────────────────────────────────

echo ""
echo -e "${YELLOW}[7/7] Pulling model: ${MODEL_NAME}...${NC}"
echo "  This downloads the model inside the Ollama container."
echo "  Size is typically 1-4GB depending on the model."
echo ""

docker compose exec ollama ollama pull "${MODEL_NAME}"

echo ""
echo -e "  ${GREEN}✓ Model ${MODEL_NAME} ready${NC}"

# Wait for gateway to be healthy
echo ""
echo -e "  Waiting for OpenClaw gateway..."
ATTEMPTS=0
MAX_ATTEMPTS=20
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    if curl -sf http://localhost:18789/health > /dev/null 2>&1; then
        break
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    sleep 2
done

if [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; then
    echo -e "  ${GREEN}✓ OpenClaw gateway is running${NC}"
else
    echo -e "  ${YELLOW}⚠ Gateway started but health check pending. Check:${NC}"
    echo "    docker compose logs -f openclaw-gateway"
fi

# ─── Summary ────────────────────────────────────────────────

echo ""
echo "======================================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "======================================================="
echo ""
echo -e "  ${CYAN}Web UI:${NC}      http://localhost:18789"
echo -e "  ${CYAN}Token:${NC}       ${TOKEN}"
echo -e "  ${CYAN}Model:${NC}       ${MODEL_NAME}"
if [ "$HAS_GPU" = true ]; then
echo -e "  ${CYAN}GPU:${NC}         Enabled (NVIDIA)"
else
echo -e "  ${CYAN}GPU:${NC}         Not available (CPU mode)"
fi
echo -e "  ${CYAN}Config:${NC}      ${DATA_DIR}/config/openclaw.json"
echo -e "  ${CYAN}Workspace:${NC}   ${DATA_DIR}/workspace/"
echo ""
echo -e "${YELLOW}Quick Commands:${NC}"
echo "  View logs:      docker compose logs -f"
echo "  Stop all:       docker compose stop"
echo "  Start all:      docker compose start"
echo "  Restart all:    docker compose restart"
echo "  Tear down:      docker compose down"
echo "  Pull new model: docker compose exec ollama ollama pull <model>"
echo "  List models:    docker compose exec ollama ollama list"
echo "  CLI status:     docker compose run --rm openclaw-cli status"
echo ""
echo -e "${GREEN}Open http://localhost:18789 in your browser to get started!${NC}"

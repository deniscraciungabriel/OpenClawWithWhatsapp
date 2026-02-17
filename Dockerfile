FROM node:20-slim

# Install system dependencies for Playwright and general use
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r node || true && \
    useradd -r -g node -m -d /home/node -s /bin/bash node || true

# Set working directory
WORKDIR /home/node/app

# Copy package files
COPY package.json tsconfig.json ./

# Install dependencies
RUN npm install && \
    npx playwright install chromium --with-deps && \
    npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create directories for config and workspace
RUN mkdir -p /home/node/.openclaw/memory \
             /home/node/.openclaw/logs \
             /home/node/.openclaw/workspace \
             /home/node/.openclaw/whatsapp-auth \
    && chown -R node:node /home/node

# Switch to non-root user
USER node

# Expose gateway port
EXPOSE 18789

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:18789/health || exit 1

# Default command: start the gateway
CMD ["node", "dist/index.js"]

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { OpenClawConfig } from '../config/configManager';
import { Agent, AgentConfig } from './agent';
import { ChannelManager } from '../channels/channelManager';
import { Logger } from '../utils/logger';

const logger = Logger.create('server');

export class GatewayServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private config: OpenClawConfig;
  private agent: Agent;
  private channelManager: ChannelManager;

  constructor(config: OpenClawConfig) {
    this.config = config;
    this.app = express();

    const agentConfig: AgentConfig = {
      llm: config.llm,
      tools: config.tools,
      memory: config.memory,
      workspaceDir: '/home/node/.openclaw/workspace',
      configDir: '/home/node/.openclaw',
    };

    this.agent = new Agent(agentConfig);
    this.channelManager = new ChannelManager(config.channels);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(helmet({ contentSecurityPolicy: false }));
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  private authenticate(req: Request, res: Response, next: NextFunction): void {
    const token = this.config.gateway.auth.token;
    if (!token) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string;
    const bodyToken = (req.body as any)?.token;

    const providedToken =
      authHeader?.replace('Bearer ', '') || queryToken || bodyToken;

    if (providedToken !== token) {
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    next();
  }

  private setupRoutes(): void {
    // Public routes
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    // Static files for web UI
    this.app.get('/', (_req: Request, res: Response) => {
      res.send(this.getWebUI());
    });

    // Protected routes
    this.app.post(
      '/api/chat',
      this.authenticate.bind(this),
      async (req: Request, res: Response) => {
        try {
          const { message, conversation_id } = req.body;

          if (!message) {
            res.status(400).json({ error: 'Message is required' });
            return;
          }

          const convId = conversation_id || uuidv4();
          const response = await this.agent.chat(convId, message);

          res.json({
            response,
            conversation_id: convId,
          });
        } catch (err: any) {
          logger.error(`Chat error: ${err.message}`);
          res.status(500).json({ error: err.message });
        }
      }
    );

    this.app.post(
      '/api/chat/clear',
      this.authenticate.bind(this),
      (req: Request, res: Response) => {
        const { conversation_id } = req.body;
        if (conversation_id) {
          this.agent.clearConversation(conversation_id);
        }
        res.json({ status: 'cleared' });
      }
    );

    this.app.get(
      '/api/status',
      this.authenticate.bind(this),
      async (_req: Request, res: Response) => {
        const connected = await this.agent.testConnection();
        res.json({
          status: 'running',
          llm: {
            connected,
            provider: this.config.llm.provider,
            model: this.config.llm.model,
          },
          channels: this.channelManager.getStatus(),
          uptime: process.uptime(),
        });
      }
    );

    this.app.get(
      '/api/models',
      this.authenticate.bind(this),
      async (_req: Request, res: Response) => {
        const models = await this.agent.listModels();
        res.json({ models, current: this.config.llm.model });
      }
    );

    this.app.get(
      '/api/channels',
      this.authenticate.bind(this),
      (_req: Request, res: Response) => {
        res.json({
          channels: this.channelManager.listChannels(),
          status: this.channelManager.getStatus(),
        });
      }
    );
  }

  async start(): Promise<void> {
    const bindAddress = this.config.gateway.bind === 'loopback' ? '127.0.0.1' : '0.0.0.0';

    return new Promise((resolve) => {
      this.server = this.app.listen(
        this.config.gateway.port,
        bindAddress,
        async () => {
          logger.info(
            `Binding to ${this.config.gateway.bind}:${this.config.gateway.port}`
          );

          // Wire channels to agent and start them
          this.channelManager.setHandler(async (msg) => {
            const conversationId = `${msg.channelType}-${msg.senderId}`;
            return this.agent.chat(conversationId, msg.text);
          });
          await this.channelManager.startAll();

          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    await this.agent.cleanup();
    await this.channelManager.stopAll();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private getWebUI(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Control</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
    .header { background: #1a1a2e; padding: 16px 24px; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between; }
    .header h1 { font-size: 20px; color: #00d4ff; }
    .status { font-size: 12px; padding: 4px 12px; border-radius: 12px; }
    .status.connected { background: #0a3d0a; color: #4caf50; }
    .status.disconnected { background: #3d0a0a; color: #f44336; }
    .chat-container { flex: 1; overflow-y: auto; padding: 24px; }
    .message { margin-bottom: 16px; max-width: 80%; }
    .message.user { margin-left: auto; }
    .message .bubble { padding: 12px 16px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
    .message.user .bubble { background: #1a3a5c; color: #fff; border-bottom-right-radius: 4px; }
    .message.assistant .bubble { background: #1a1a2e; color: #e0e0e0; border-bottom-left-radius: 4px; border: 1px solid #333; }
    .message .label { font-size: 11px; color: #888; margin-bottom: 4px; }
    .message.user .label { text-align: right; }
    .input-area { padding: 16px 24px; background: #111; border-top: 1px solid #333; }
    .input-row { display: flex; gap: 12px; max-width: 900px; margin: 0 auto; }
    .input-row input { flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; font-size: 14px; outline: none; }
    .input-row input:focus { border-color: #00d4ff; }
    .input-row button { padding: 12px 24px; border-radius: 8px; border: none; background: #00d4ff; color: #000; font-weight: 600; cursor: pointer; font-size: 14px; }
    .input-row button:hover { background: #00b8d9; }
    .input-row button:disabled { background: #333; color: #666; cursor: not-allowed; }
    .auth-screen { display: flex; align-items: center; justify-content: center; height: 100vh; }
    .auth-box { background: #1a1a2e; padding: 32px; border-radius: 12px; border: 1px solid #333; width: 360px; }
    .auth-box h2 { margin-bottom: 16px; color: #00d4ff; }
    .auth-box input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #333; background: #0a0a0a; color: #fff; margin-bottom: 16px; font-size: 14px; }
    .auth-box button { width: 100%; padding: 12px; border-radius: 8px; border: none; background: #00d4ff; color: #000; font-weight: 600; cursor: pointer; font-size: 14px; }
  </style>
</head>
<body>
  <div id="auth-screen" class="auth-screen">
    <div class="auth-box">
      <h2>OpenClaw</h2>
      <p style="color:#888;margin-bottom:16px;">Enter your gateway token to continue</p>
      <input type="password" id="token-input" placeholder="Gateway token..." onkeydown="if(event.key==='Enter')authenticate()">
      <button onclick="authenticate()">Connect</button>
    </div>
  </div>
  <div id="main" style="display:none;height:100vh;flex-direction:column;">
    <div class="header">
      <h1>OpenClaw</h1>
      <span id="status" class="status disconnected">checking...</span>
    </div>
    <div class="chat-container" id="chat"></div>
    <div class="input-area">
      <div class="input-row">
        <input type="text" id="message-input" placeholder="Ask OpenClaw anything..." onkeydown="if(event.key==='Enter'&&!event.shiftKey)sendMessage()">
        <button id="send-btn" onclick="sendMessage()">Send</button>
      </div>
    </div>
  </div>
  <script>
    let token = localStorage.getItem('openclaw_token') || '';
    let conversationId = null;
    if (token) authenticate(true);

    async function authenticate(auto) {
      if (!auto) token = document.getElementById('token-input').value;
      try {
        const res = await fetch('/api/status', { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.ok) {
          localStorage.setItem('openclaw_token', token);
          document.getElementById('auth-screen').style.display = 'none';
          const main = document.getElementById('main');
          main.style.display = 'flex';
          const data = await res.json();
          const st = document.getElementById('status');
          st.textContent = data.llm.connected ? 'Connected - ' + data.llm.model : 'LLM Disconnected';
          st.className = 'status ' + (data.llm.connected ? 'connected' : 'disconnected');
        } else {
          if (!auto) alert('Invalid token');
        }
      } catch(e) {
        if (!auto) alert('Connection failed');
      }
    }

    async function sendMessage() {
      const input = document.getElementById('message-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addMessage('user', text);
      document.getElementById('send-btn').disabled = true;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ message: text, conversation_id: conversationId })
        });
        const data = await res.json();
        conversationId = data.conversation_id;
        addMessage('assistant', data.response || data.error);
      } catch(e) {
        addMessage('assistant', 'Error: ' + e.message);
      }
      document.getElementById('send-btn').disabled = false;
      input.focus();
    }

    function addMessage(role, text) {
      const chat = document.getElementById('chat');
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.innerHTML = '<div class="label">' + (role === 'user' ? 'You' : 'OpenClaw') + '</div><div class="bubble">' + escapeHtml(text) + '</div>';
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function escapeHtml(t) {
      const d = document.createElement('div');
      d.textContent = t;
      return d.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}

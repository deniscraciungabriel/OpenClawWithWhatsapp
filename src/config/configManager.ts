import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

const logger = Logger.create('config');

export interface OpenClawConfig {
  gateway: {
    bind: string;
    port: number;
    auth: {
      token: string;
    };
  };
  llm: {
    provider: string;
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
    input: string;
  };
  tools: {
    bash: {
      enabled: boolean;
      timeout: number;
      allowedCommands?: string[];
      deniedCommands?: string[];
    };
    browser: {
      enabled: boolean;
      headless?: boolean;
      timeout?: number;
    };
    file: {
      enabled: boolean;
    };
    claudeCode?: {
      enabled: boolean;
      timeout?: number;
    };
  };
  channels: ChannelConfig[];
  memory: {
    enabled: boolean;
    type: string;
  };
}

export interface ChannelConfig {
  type: string;
  name: string;
  autoStart?: boolean;
  config: Record<string, unknown>;
}

const DEFAULT_CONFIG: OpenClawConfig = {
  gateway: {
    bind: 'lan',
    port: 18789,
    auth: {
      token: '',
    },
  },
  llm: {
    provider: 'ollama',
    baseURL: 'http://ollama:11434/v1',
    model: 'llama3.2:3b',
    temperature: 0.7,
    maxTokens: 4096,
    input: 'text',
  },
  tools: {
    bash: {
      enabled: true,
      timeout: 30000,
    },
    browser: {
      enabled: true,
      headless: true,
      timeout: 30000,
    },
    file: {
      enabled: true,
    },
  },
  channels: [],
  memory: {
    enabled: true,
    type: 'local',
  },
};

export class ConfigManager {
  private static configPaths = [
    '/home/node/.openclaw/openclaw.json',
    path.join(process.cwd(), 'openclaw.json'),
    path.join(process.env.HOME || '', '.openclaw', 'openclaw.json'),
  ];

  static load(): OpenClawConfig {
    let fileConfig: Partial<OpenClawConfig> = {};

    for (const configPath of this.configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const raw = fs.readFileSync(configPath, 'utf-8');
          fileConfig = JSON.parse(raw);
          logger.info(`Loaded config from ${configPath}`);
          break;
        } catch (err) {
          logger.warn(`Failed to parse config at ${configPath}: ${err}`);
        }
      }
    }

    const config = this.merge(DEFAULT_CONFIG, fileConfig);

    // Override from environment variables
    if (process.env.OPENCLAW_GATEWAY_TOKEN) {
      config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
    }
    if (process.env.OPENCLAW_GATEWAY_BIND) {
      config.gateway.bind = process.env.OPENCLAW_GATEWAY_BIND;
    }
    if (process.env.OPENCLAW_GATEWAY_PORT) {
      config.gateway.port = parseInt(process.env.OPENCLAW_GATEWAY_PORT, 10);
    }
    if (process.env.OLLAMA_BASE_URL) {
      config.llm.baseURL = process.env.OLLAMA_BASE_URL;
    }
    if (process.env.OLLAMA_MODEL) {
      config.llm.model = process.env.OLLAMA_MODEL;
    }

    return config;
  }

  static save(config: OpenClawConfig, configPath?: string): void {
    const targetPath = configPath || this.configPaths[0];
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
    logger.info(`Config saved to ${targetPath}`);
  }

  static getConfigPath(): string | null {
    for (const configPath of this.configPaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    return null;
  }

  private static merge(defaults: any, overrides: any): any {
    const result = { ...defaults };
    for (const key of Object.keys(overrides)) {
      if (
        overrides[key] &&
        typeof overrides[key] === 'object' &&
        !Array.isArray(overrides[key]) &&
        defaults[key]
      ) {
        result[key] = this.merge(defaults[key], overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }
}

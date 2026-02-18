import { Logger } from '../utils/logger';
import { ChannelConfig } from '../config/configManager';
import { WhatsAppChannel } from './whatsappChannel';

const logger = Logger.create('channels');

function createChannel(config: ChannelConfig): Channel | null {
  switch (config.type) {
    case 'whatsapp':
      return new WhatsAppChannel(
        config.name || 'whatsapp',
        config.config as any
      );
    default:
      logger.warn(`Unknown channel type: ${config.type}`);
      return null;
  }
}

export interface IncomingMessage {
  channelType: string;
  channelName: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  raw?: unknown;
}

export interface OutgoingMessage {
  channelType: string;
  channelName: string;
  recipientId: string;
  text: string;
}

export type MessageHandler = (message: IncomingMessage) => Promise<string>;

export interface Channel {
  type: string;
  name: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  isConnected(): boolean;
}

export class ChannelManager {
  private channels: Map<string, Channel> = new Map();
  private configs: Map<string, ChannelConfig> = new Map();
  private handler: MessageHandler | null = null;

  constructor(configs: ChannelConfig[]) {
    for (const config of configs) {
      const channel = createChannel(config);
      if (channel) {
        const key = config.name || config.type;
        this.channels.set(key, channel);
        this.configs.set(key, config);
        logger.info(`Channel registered: ${config.type} (${key})`);
      }
    }
  }

  setHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  async startAll(): Promise<void> {
    for (const [name, channel] of this.channels) {
      const config = this.configs.get(name);
      if (config?.autoStart === false) {
        logger.info(`Channel skipped (autoStart=false): ${name}`);
        continue;
      }
      try {
        if (this.handler) {
          await channel.start(this.handler);
          logger.info(`Channel started: ${name}`);
        }
      } catch (err) {
        logger.error(`Failed to start channel ${name}: ${err}`);
      }
    }
  }

  async startChannel(name: string): Promise<void> {
    const channel = this.channels.get(name);
    if (!channel) {
      throw new Error(`Channel not found: ${name}`);
    }
    if (channel.isConnected()) {
      throw new Error(`Channel already running: ${name}`);
    }
    if (!this.handler) {
      throw new Error('No message handler set');
    }
    await channel.start(this.handler);
    logger.info(`Channel started: ${name}`);
  }

  async stopChannel(name: string): Promise<void> {
    const channel = this.channels.get(name);
    if (!channel) {
      throw new Error(`Channel not found: ${name}`);
    }
    if (!channel.isConnected()) {
      throw new Error(`Channel not running: ${name}`);
    }
    await channel.stop();
    logger.info(`Channel stopped: ${name}`);
  }

  async stopAll(): Promise<void> {
    for (const [name, channel] of this.channels) {
      try {
        await channel.stop();
        logger.info(`Channel stopped: ${name}`);
      } catch (err) {
        logger.error(`Failed to stop channel ${name}: ${err}`);
      }
    }
  }

  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const [name, channel] of this.channels) {
      status[name] = channel.isConnected();
    }
    return status;
  }

  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

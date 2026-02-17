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
  private handler: MessageHandler | null = null;

  constructor(configs: ChannelConfig[]) {
    for (const config of configs) {
      const channel = createChannel(config);
      if (channel) {
        const key = config.name || config.type;
        this.channels.set(key, channel);
        logger.info(`Channel registered: ${config.type} (${key})`);
      }
    }
  }

  setHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  async startAll(): Promise<void> {
    for (const [name, channel] of this.channels) {
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

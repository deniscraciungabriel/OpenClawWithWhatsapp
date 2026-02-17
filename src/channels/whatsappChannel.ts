import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  proto,
  isJidUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import { Channel, MessageHandler, IncomingMessage } from './channelManager';
import { Logger } from '../utils/logger';

const logger = Logger.create('whatsapp');

export interface WhatsAppChannelConfig {
  authDir: string;
  allowedSenders?: string[];
  replyOnlyToDirectMessages?: boolean;
}

export class WhatsAppChannel implements Channel {
  readonly type = 'whatsapp';
  readonly name: string;

  private config: WhatsAppChannelConfig;
  private socket: WASocket | null = null;
  private handler: MessageHandler | null = null;
  private connected = false;
  private processedMessages = new Set<string>();
  private botSentMessages = new Set<string>();
  private messageStore = new Map<string, proto.IMessage>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private stopping = false;

  constructor(name: string, config: WhatsAppChannelConfig) {
    this.name = name;
    this.config = config;
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.stopping = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.connected = false;
    logger.info('WhatsApp channel stopped');
  }

  async send(message: { recipientId: string; text: string }): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp socket not connected');
    }
    const jid = message.recipientId.includes('@')
      ? message.recipientId
      : `${message.recipientId}@s.whatsapp.net`;
    await this.socket.sendMessage(jid, { text: message.text });
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    const { version } = await fetchLatestBaileysVersion();
    logger.info(`Using WA web version: ${version.join('.')}`);

    const noop = () => {};
    const silentLogger: any = {
      level: 'silent',
      trace: noop,
      debug: noop,
      info: noop,
      warn: noop,
      error: (msg: any) => logger.error(`Baileys: ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`),
      fatal: noop,
    };
    silentLogger.child = () => silentLogger;

    const socket = makeWASocket({
      auth: state,
      version,
      browser: ['OpenClaw', 'Chrome', '131.0.0'],
      printQRInTerminal: false,
      logger: silentLogger,
      getMessage: async (key) => {
        const msg = this.messageStore.get(key.id || '');
        return msg || undefined;
      },
    });

    this.socket = socket;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('Scan this QR code with WhatsApp (Settings > Linked Devices):');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info('WhatsApp connected successfully');
      }

      if (connection === 'close') {
        this.connected = false;

        if (this.stopping) return;

        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        logger.warn(
          `WhatsApp disconnected: status=${statusCode}, reason=${error?.message || 'unknown'}`
        );

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
          logger.info(
            `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
          );
          setTimeout(() => this.connect(), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.warn('WhatsApp logged out. Delete auth dir and restart to re-link.');
        } else {
          logger.error('Max reconnection attempts reached');
        }
      }
    });

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      logger.info(`messages.upsert: type=${type}, count=${messages.length}`);
      for (const msg of messages) {
        await this.handleIncomingMessage(msg);
      }
    });
  }

  private async handleIncomingMessage(
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    logger.info(`handleMsg: key=${JSON.stringify(msg.key)}, hasMessage=${!!msg.message}`);

    // Skip messages without key or content
    if (!msg.key || !msg.message || !msg.key.remoteJid) {
      logger.info('handleMsg: skipped — missing key/message/jid');
      return;
    }

    // Skip messages sent by the bot itself (but allow user's self-chat)
    if (msg.key.fromMe && msg.key.id && this.botSentMessages.has(msg.key.id)) {
      this.botSentMessages.delete(msg.key.id);
      logger.info('handleMsg: skipped — bot sent message');
      return;
    }

    // Deduplicate
    const msgId = msg.key.id;
    if (!msgId || this.processedMessages.has(msgId)) {
      logger.info('handleMsg: skipped — duplicate');
      return;
    }
    this.processedMessages.add(msgId);

    // Limit dedup set size
    if (this.processedMessages.size > 1000) {
      const entries = Array.from(this.processedMessages);
      for (let i = 0; i < 500; i++) {
        this.processedMessages.delete(entries[i]);
      }
    }

    const jid = msg.key.remoteJid;

    // Skip group messages if configured (allow @s.whatsapp.net and @lid JIDs)
    const isDirectMessage = isJidUser(jid) || jid.endsWith('@lid');
    if (this.config.replyOnlyToDirectMessages && !isDirectMessage) {
      logger.info(`handleMsg: skipped — not direct message, jid=${jid}`);
      return;
    }

    // Check allowed senders
    if (
      this.config.allowedSenders &&
      this.config.allowedSenders.length > 0
    ) {
      const senderNumber = jid.replace(/@(s\.whatsapp\.net|lid)$/, '');
      if (!this.config.allowedSenders.includes(senderNumber)) {
        logger.info(`handleMsg: skipped — sender ${senderNumber} not in allowedSenders`);
        return;
      }
    }

    // Extract text from various message types
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    if (!text.trim()) return;

    const senderNumber = jid.replace(/@(s\.whatsapp\.net|lid)$/, '');

    const incoming: IncomingMessage = {
      channelType: 'whatsapp',
      channelName: this.name,
      senderId: senderNumber,
      senderName: msg.pushName || senderNumber,
      text: text.trim(),
      timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
      raw: msg,
    };

    if (!this.handler) return;

    try {
      // Send typing indicator
      if (this.socket) {
        await this.socket.presenceSubscribe(jid);
        await this.socket.sendPresenceUpdate('composing', jid);
      }

      const response = await this.handler(incoming);

      // Clear typing indicator
      if (this.socket) {
        await this.socket.sendPresenceUpdate('paused', jid);
      }

      if (response && this.socket) {
        // LID JIDs can't receive messages; resolve to phone number JID
        let replyJid = jid;
        if (jid.endsWith('@lid') && this.socket.user?.id) {
          replyJid = this.socket.user.id.replace(/:.*@/, '@');
          logger.info(`Resolved LID ${jid} to ${replyJid}`);
        }
        const msgContent = { conversation: response };
        const sent = await this.socket.sendMessage(replyJid, { text: response });
        logger.info(`Sent reply to ${replyJid}, msgId=${sent?.key?.id}`);
        if (sent?.key?.id) {
          this.botSentMessages.add(sent.key.id);
          this.messageStore.set(sent.key.id, msgContent);
          // Clean up store after 5 minutes
          setTimeout(() => this.messageStore.delete(sent.key.id!), 5 * 60 * 1000);
        }
      }
    } catch (err) {
      logger.error(`Error handling WhatsApp message: ${err}`);
      if (this.socket) {
        await this.socket.sendPresenceUpdate('paused', jid);
      }
    }
  }
}

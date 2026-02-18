import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

const logger = Logger.create('claude-code-tool');

const SSH_KEY_DIR = '/home/node/.openclaw/ssh';
const SSH_KEY_PATH = path.join(SSH_KEY_DIR, 'id_ed25519');

export interface ClaudeCodeToolConfig {
  enabled: boolean;
  timeout?: number;
}

export interface ClaudeCodeResult {
  output: string;
  error?: string;
  timedOut: boolean;
}

export class ClaudeCodeTool {
  private config: ClaudeCodeToolConfig;
  private hostUser: string;
  private hostIP: string;
  private keyReady: boolean = false;

  constructor(config: ClaudeCodeToolConfig) {
    this.config = config;
    this.hostUser = process.env.HOST_USER || 'utente';
    this.hostIP = process.env.HOST_IP || this.detectHostIP();
    this.ensureSSHKey();
  }

  private detectHostIP(): string {
    try {
      const route = execSync('ip route | grep default', { encoding: 'utf-8' });
      const match = route.match(/via\s+(\S+)/);
      if (match) return match[1];
    } catch {}
    return '172.17.0.1';
  }

  private ensureSSHKey(): void {
    if (fs.existsSync(SSH_KEY_PATH)) {
      this.keyReady = true;
      return;
    }

    try {
      fs.mkdirSync(SSH_KEY_DIR, { recursive: true });
      execSync(
        `ssh-keygen -t ed25519 -f ${SSH_KEY_PATH} -N "" -C "openclaw-agent"`,
        { stdio: 'pipe' }
      );
      fs.chmodSync(SSH_KEY_PATH, 0o600);
      this.keyReady = true;

      const pubKey = fs.readFileSync(`${SSH_KEY_PATH}.pub`, 'utf-8').trim();
      logger.info('==========================================================');
      logger.info('SSH key generated for host access. Run this on your host:');
      logger.info('');
      logger.info(`  echo '${pubKey}' >> ~/.ssh/authorized_keys`);
      logger.info('');
      logger.info('==========================================================');
    } catch (err: any) {
      logger.error(`Failed to generate SSH key: ${err.message}`);
    }
  }

  getSetupInstructions(): string | null {
    if (!this.keyReady) return null;
    try {
      const pubKey = fs.readFileSync(`${SSH_KEY_PATH}.pub`, 'utf-8').trim();
      return `echo '${pubKey}' >> ~/.ssh/authorized_keys`;
    } catch {
      return null;
    }
  }

  async execute(prompt: string, workdir?: string): Promise<ClaudeCodeResult> {
    if (!this.config.enabled) {
      return { output: '', error: 'Claude Code tool is disabled', timedOut: false };
    }

    if (!this.keyReady) {
      return { output: '', error: 'SSH key not ready — check container logs', timedOut: false };
    }

    const cwd = workdir || `$(pwd)`;
    const timeout = this.config.timeout || 300000;

    // Escape single quotes in prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    const sshArgs = [
      '-i', SSH_KEY_PATH,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'LogLevel=ERROR',
      `${this.hostUser}@${this.hostIP}`,
      `cd ${cwd} && claude -p '${escapedPrompt}'`,
    ];

    logger.info(`Running Claude Code on host via SSH (${this.hostUser}@${this.hostIP})`);

    return new Promise((resolve) => {
      let output = '';
      let timedOut = false;

      const proc = spawn('ssh', sshArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        logger.warn('Claude Code timed out');
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        // Filter out SSH warnings, keep actual errors
        if (!text.includes('Warning: Permanently added')) {
          output += text;
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ output, timedOut: true, error: 'Timed out' });
        } else if (code !== 0 && code !== null) {
          if (code === 255) {
            logger.error('SSH connection failed — is the SSH key authorized on the host?');
            resolve({
              output: '',
              timedOut: false,
              error: `SSH connection to ${this.hostUser}@${this.hostIP} failed. Run this on your host to authorize the container:\n\n  ${this.getSetupInstructions() || 'Check container logs for the SSH public key'}`,
            });
          } else {
            resolve({ output, timedOut: false, error: `Exit code: ${code}` });
          }
        } else {
          logger.info(`Claude Code completed (${output.length} chars)`);
          resolve({ output, timedOut: false });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ output: '', timedOut: false, error: `Failed to run ssh: ${err.message}` });
      });
    });
  }
}

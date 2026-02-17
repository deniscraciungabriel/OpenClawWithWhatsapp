import { exec, ExecOptions } from 'child_process';
import { Logger } from '../utils/logger';

const logger = Logger.create('bash-tool');

export interface BashToolConfig {
  enabled: boolean;
  timeout: number;
  allowedCommands?: string[];
  deniedCommands?: string[];
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export class BashTool {
  private config: BashToolConfig;

  constructor(config: BashToolConfig) {
    this.config = config;
  }

  async execute(command: string, cwd?: string): Promise<BashResult> {
    if (!this.config.enabled) {
      return {
        stdout: '',
        stderr: 'Bash tool is disabled',
        exitCode: 1,
        timedOut: false,
      };
    }

    if (!this.isCommandAllowed(command)) {
      return {
        stdout: '',
        stderr: `Command not allowed: ${command.split(' ')[0]}`,
        exitCode: 1,
        timedOut: false,
      };
    }

    logger.info(`Executing: ${command}`);

    return new Promise((resolve) => {
      const options: ExecOptions = {
        timeout: this.config.timeout,
        cwd: cwd || '/home/node/.openclaw/workspace',
        maxBuffer: 1024 * 1024 * 10, // 10MB
        env: { ...process.env, HOME: '/home/node' },
      };

      exec(command, options, (error, stdout, stderr) => {
        const timedOut = error?.killed === true;
        const exitCode = error?.code
          ? (typeof error.code === 'number' ? error.code : 1)
          : 0;

        if (timedOut) {
          logger.warn(`Command timed out: ${command}`);
        }

        resolve({
          stdout: stdout?.toString() || '',
          stderr: stderr?.toString() || '',
          exitCode: exitCode as number,
          timedOut,
        });
      });
    });
  }

  private isCommandAllowed(command: string): boolean {
    const baseCommand = command.trim().split(/\s+/)[0];

    if (this.config.deniedCommands?.includes(baseCommand)) {
      logger.warn(`Denied command: ${baseCommand}`);
      return false;
    }

    if (
      this.config.allowedCommands &&
      this.config.allowedCommands.length > 0
    ) {
      return this.config.allowedCommands.includes(baseCommand);
    }

    return true;
  }
}

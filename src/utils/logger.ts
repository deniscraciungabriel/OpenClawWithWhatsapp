export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private context: string;
  private static level: LogLevel = LogLevel.INFO;

  private constructor(context: string) {
    this.context = context;
  }

  static create(context: string): Logger {
    return new Logger(context);
  }

  static setLevel(level: LogLevel): void {
    Logger.level = level;
  }

  private format(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[OpenClaw] ${timestamp} [${level}] [${this.context}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.DEBUG) {
      console.debug(this.format('DEBUG', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.INFO) {
      console.log(this.format('INFO', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.WARN) {
      console.warn(this.format('WARN', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.ERROR) {
      console.error(this.format('ERROR', message), ...args);
    }
  }
}

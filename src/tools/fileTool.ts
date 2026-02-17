import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

const logger = Logger.create('file-tool');

export interface FileToolConfig {
  enabled: boolean;
}

export class FileTool {
  private config: FileToolConfig;
  private workspaceDir: string;

  constructor(config: FileToolConfig, workspaceDir: string) {
    this.config = config;
    this.workspaceDir = workspaceDir;
  }

  readFile(filePath: string): string {
    if (!this.config.enabled) {
      throw new Error('File tool is disabled');
    }
    const resolved = this.resolvePath(filePath);
    logger.info(`Reading file: ${resolved}`);
    return fs.readFileSync(resolved, 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    if (!this.config.enabled) {
      throw new Error('File tool is disabled');
    }
    const resolved = this.resolvePath(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    logger.info(`Writing file: ${resolved}`);
    fs.writeFileSync(resolved, content, 'utf-8');
  }

  listDirectory(dirPath: string): string[] {
    if (!this.config.enabled) {
      throw new Error('File tool is disabled');
    }
    const resolved = this.resolvePath(dirPath);
    logger.info(`Listing directory: ${resolved}`);
    return fs.readdirSync(resolved);
  }

  deleteFile(filePath: string): void {
    if (!this.config.enabled) {
      throw new Error('File tool is disabled');
    }
    const resolved = this.resolvePath(filePath);
    logger.info(`Deleting file: ${resolved}`);
    fs.unlinkSync(resolved);
  }

  fileExists(filePath: string): boolean {
    const resolved = this.resolvePath(filePath);
    return fs.existsSync(resolved);
  }

  getFileInfo(filePath: string): fs.Stats {
    const resolved = this.resolvePath(filePath);
    return fs.statSync(resolved);
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.workspaceDir, filePath);
  }
}

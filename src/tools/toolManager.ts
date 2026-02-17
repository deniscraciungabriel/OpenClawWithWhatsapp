import { BashTool, BashToolConfig } from './bashTool';
import { FileTool, FileToolConfig } from './fileTool';
import { BrowserTool, BrowserToolConfig } from './browserTool';
import { ToolDefinition } from '../llm/ollamaProvider';
import { Logger } from '../utils/logger';

const logger = Logger.create('tool-manager');

export interface ToolsConfig {
  bash: BashToolConfig;
  browser: BrowserToolConfig;
  file: FileToolConfig;
}

export class ToolManager {
  private bashTool: BashTool;
  private fileTool: FileTool;
  private browserTool: BrowserTool;

  constructor(config: ToolsConfig, workspaceDir: string) {
    this.bashTool = new BashTool(config.bash);
    this.fileTool = new FileTool(config.file, workspaceDir);
    this.browserTool = new BrowserTool(config.browser);
  }

  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    tools.push({
      type: 'function',
      function: {
        name: 'bash',
        description:
          'Execute a bash command in the workspace. Use for system operations, running programs, file manipulation, and more.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The bash command to execute',
            },
          },
          required: ['command'],
        },
      },
    });

    tools.push({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to read',
            },
          },
          required: ['path'],
        },
      },
    });

    tools.push({
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file, creating it if it does not exist',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to write',
            },
            content: {
              type: 'string',
              description: 'Content to write to the file',
            },
          },
          required: ['path', 'content'],
        },
      },
    });

    tools.push({
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and directories in a given path',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path to list (defaults to workspace)',
            },
          },
          required: [],
        },
      },
    });

    tools.push({
      type: 'function',
      function: {
        name: 'browse',
        description:
          'Visit a URL and return the page title and text content',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to visit',
            },
          },
          required: ['url'],
        },
      },
    });

    return tools;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    logger.info(`Executing tool: ${name}`);

    switch (name) {
      case 'bash': {
        const result = await this.bashTool.execute(args.command as string);
        const output = result.stdout || result.stderr;
        return result.timedOut
          ? `Command timed out.\n${output}`
          : `Exit code: ${result.exitCode}\n${output}`;
      }

      case 'read_file': {
        try {
          return this.fileTool.readFile(args.path as string);
        } catch (err: any) {
          return `Error reading file: ${err.message}`;
        }
      }

      case 'write_file': {
        try {
          this.fileTool.writeFile(
            args.path as string,
            args.content as string
          );
          return `File written successfully: ${args.path}`;
        } catch (err: any) {
          return `Error writing file: ${err.message}`;
        }
      }

      case 'list_directory': {
        try {
          const files = this.fileTool.listDirectory(
            (args.path as string) || '.'
          );
          return files.join('\n');
        } catch (err: any) {
          return `Error listing directory: ${err.message}`;
        }
      }

      case 'browse': {
        const result = await this.browserTool.browse(args.url as string);
        if (result.error) {
          return `Error browsing ${args.url}: ${result.error}`;
        }
        return `Title: ${result.title}\n\n${result.content}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  async cleanup(): Promise<void> {
    await this.browserTool.close();
  }
}

import { BashTool, BashToolConfig } from './bashTool';
import { FileTool, FileToolConfig } from './fileTool';
import { BrowserTool, BrowserToolConfig } from './browserTool';
import { ClaudeCodeTool, ClaudeCodeToolConfig } from './claudeCodeTool';
import { ToolDefinition } from '../llm/llmProvider';
import { Logger } from '../utils/logger';

const logger = Logger.create('tool-manager');

export interface ToolsConfig {
  bash: BashToolConfig;
  browser: BrowserToolConfig;
  file: FileToolConfig;
  claudeCode?: ClaudeCodeToolConfig;
}

export class ToolManager {
  private bashTool: BashTool;
  private fileTool: FileTool;
  private browserTool: BrowserTool;
  private claudeCodeTool: ClaudeCodeTool | null;

  constructor(config: ToolsConfig, workspaceDir: string) {
    this.bashTool = new BashTool(config.bash);
    this.fileTool = new FileTool(config.file, workspaceDir);
    this.browserTool = new BrowserTool(config.browser);
    this.claudeCodeTool = config.claudeCode?.enabled
      ? new ClaudeCodeTool(config.claudeCode)
      : null;
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

    if (this.claudeCodeTool) {
      tools.push({
        type: 'function',
        function: {
          name: 'claude_code',
          description:
            'Delegate a coding task to Claude Code, an expert AI coding agent. Use this for writing code, building projects, debugging, refactoring, and any software engineering task. Claude Code can read/write files and run commands autonomously. Provide a clear, detailed prompt describing what you want built or fixed.',
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description:
                  'The coding task to perform. Be specific about what to build, which files to modify, and any requirements.',
              },
              workdir: {
                type: 'string',
                description:
                  'Working directory for the task (defaults to /home/node/.openclaw/workspace)',
              },
            },
            required: ['prompt'],
          },
        },
      });
    }

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

      case 'claude_code': {
        if (!this.claudeCodeTool) {
          return 'Claude Code tool is not enabled';
        }
        const result = await this.claudeCodeTool.execute(
          args.prompt as string,
          args.workdir as string | undefined
        );
        if (result.error) {
          return `Claude Code error: ${result.error}\n${result.output}`;
        }
        if (result.timedOut) {
          return `Claude Code timed out.\n${result.output}`;
        }
        return result.output;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  async cleanup(): Promise<void> {
    await this.browserTool.close();
  }
}

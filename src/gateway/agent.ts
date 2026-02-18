import {
  LLMProvider,
  ChatMessage,
  LLMConfig,
  ToolCall,
} from '../llm/llmProvider';
import { ToolManager, ToolsConfig } from '../tools/toolManager';
import { MemoryManager, MemoryConfig } from '../memory/memoryManager';
import { Logger } from '../utils/logger';

const logger = Logger.create('agent');

function buildSystemPrompt(): string {
  const hostUser = process.env.HOST_USER || 'utente';
  const hostHome = process.env.HOST_HOME_DIR || `/home/${hostUser}`;

  return `You are OpenClaw, an AI assistant with full access to the user's computer. You have tools to execute bash commands, read/write files, and browse the web.

When the user asks you to perform tasks, use the appropriate tools. Be helpful, concise, and proactive.

Important:
- Your workspace is at /home/node/.openclaw/workspace
- The user's home directory is accessible at /host-home (inside this container)
- The host user is "${hostUser}" with home directory "${hostHome}"
- Use the bash tool for system operations
- Use file tools for reading and writing files
- Use the browse tool to visit websites and open web pages — when you browse a URL, a real browser window opens on the user's screen
- When the user asks you to "open" a website, use the browse tool immediately — do NOT suggest they open it manually
- Use the claude_code tool for any coding task — building websites, writing scripts, debugging code, refactoring, etc. It is a powerful AI coding agent that can read/write files and run commands. Delegate all software engineering work to it.
- When the user asks you to "code", "build", "create a website", "write a script", or any programming task, use the claude_code tool immediately
- IMPORTANT: The claude_code tool runs on the HOST machine via SSH, not inside this container. When specifying workdir for claude_code, use real host paths under "${hostHome}" (e.g., "${hostHome}/Scrivania"), NOT container paths like /host-home. The /host-home mount is only for your own bash/file tools.
- Always confirm before destructive operations`;
}

export interface AgentConfig {
  llm: LLMConfig;
  tools: ToolsConfig;
  memory: MemoryConfig;
  workspaceDir: string;
  configDir: string;
}

export class Agent {
  private llm: LLMProvider;
  private toolManager: ToolManager;
  private memory: MemoryManager;
  private conversations: Map<string, ChatMessage[]> = new Map();

  constructor(config: AgentConfig) {
    this.llm = new LLMProvider(config.llm);
    this.toolManager = new ToolManager(config.tools, config.workspaceDir);
    this.memory = new MemoryManager(config.memory, config.configDir);
  }

  async chat(
    conversationId: string,
    userMessage: string
  ): Promise<string> {
    let messages = this.conversations.get(conversationId) || [];

    if (messages.length === 0) {
      const systemMessage: ChatMessage = {
        role: 'system',
        content: buildSystemPrompt(),
      };

      const memoryContext = this.memory.getContext();
      if (memoryContext) {
        systemMessage.content += `\n\n${memoryContext}`;
      }

      messages.push(systemMessage);
    }

    messages.push({ role: 'user', content: userMessage });

    const tools = this.toolManager.getToolDefinitions();
    let maxIterations = 10;

    while (maxIterations > 0) {
      maxIterations--;

      let response;
      try {
        logger.info(`Agent loop iteration ${10 - maxIterations}, sending ${messages.length} messages to LLM`);
        response = await this.llm.chat(messages, tools);
      } catch (err: any) {
        logger.error(`LLM call failed: ${err.message}`);
        this.conversations.set(conversationId, messages);
        return `Sorry, the LLM request failed: ${err.message}`;
      }

      if (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          const args = this.parseToolArgs(toolCall);
          logger.info(`Calling tool: ${toolCall.function.name}`);

          let result: string;
          try {
            result = await this.toolManager.executeTool(
              toolCall.function.name,
              args
            );
          } catch (err: any) {
            logger.error(`Tool ${toolCall.function.name} threw: ${err.message}`);
            result = `Tool error: ${err.message}`;
          }

          // Truncate large tool results to avoid overwhelming the LLM context
          const MAX_TOOL_RESULT = 4000;
          if (result.length > MAX_TOOL_RESULT) {
            logger.info(`Truncating tool result from ${result.length} to ${MAX_TOOL_RESULT} chars`);
            result = result.substring(0, MAX_TOOL_RESULT) + `\n\n[...truncated, ${result.length - MAX_TOOL_RESULT} chars omitted]`;
          }

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });

          logger.info(
            `Tool ${toolCall.function.name} completed (${result.length} chars)`
          );
        }

        // Continue the loop so the LLM can process tool results
        continue;
      }

      // No tool calls, we have a final response
      const assistantMessage = response.content || 'I processed the request but have no additional response.';
      messages.push({ role: 'assistant', content: assistantMessage });
      this.conversations.set(conversationId, messages);

      return assistantMessage;
    }

    this.conversations.set(conversationId, messages);
    return 'I reached the maximum number of tool iterations. Please try rephrasing your request.';
  }

  async testConnection(): Promise<boolean> {
    return this.llm.testConnection();
  }

  async listModels(): Promise<string[]> {
    return this.llm.listModels();
  }

  clearConversation(conversationId: string): void {
    this.conversations.delete(conversationId);
  }

  async cleanup(): Promise<void> {
    await this.toolManager.cleanup();
  }

  private parseToolArgs(toolCall: ToolCall): Record<string, unknown> {
    try {
      return JSON.parse(toolCall.function.arguments);
    } catch {
      return { command: toolCall.function.arguments };
    }
  }
}

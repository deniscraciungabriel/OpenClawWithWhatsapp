import {
  OllamaProvider,
  ChatMessage,
  LLMConfig,
  ToolCall,
} from '../llm/ollamaProvider';
import { ToolManager, ToolsConfig } from '../tools/toolManager';
import { MemoryManager, MemoryConfig } from '../memory/memoryManager';
import { Logger } from '../utils/logger';

const logger = Logger.create('agent');

const SYSTEM_PROMPT = `You are OpenClaw, an AI assistant running inside a Docker container. You have access to tools that let you execute bash commands, read/write files, and browse the web.

When the user asks you to perform tasks, use the appropriate tools. Be helpful, concise, and proactive.

Important:
- You are running inside a Docker container on Linux
- Your workspace is at /home/node/.openclaw/workspace
- Use the bash tool for system operations
- Use file tools for reading and writing files
- Use the browse tool to visit websites
- Always confirm before destructive operations`;

export interface AgentConfig {
  llm: LLMConfig;
  tools: ToolsConfig;
  memory: MemoryConfig;
  workspaceDir: string;
  configDir: string;
}

export class Agent {
  private llm: OllamaProvider;
  private toolManager: ToolManager;
  private memory: MemoryManager;
  private conversations: Map<string, ChatMessage[]> = new Map();

  constructor(config: AgentConfig) {
    this.llm = new OllamaProvider(config.llm);
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
        content: SYSTEM_PROMPT,
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

      const response = await this.llm.chat(messages, tools);

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
          const result = await this.toolManager.executeTool(
            toolCall.function.name,
            args
          );

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
      const assistantMessage = response.content;
      messages.push({ role: 'assistant', content: assistantMessage });
      this.conversations.set(conversationId, messages);

      return assistantMessage;
    }

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

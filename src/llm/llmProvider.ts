import fetch from 'node-fetch';
import { Logger } from '../utils/logger';

const logger = Logger.create('llm');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  finish_reason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMConfig {
  provider: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  input: string;
  apiKey?: string;
}

export class LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private isOllama(): boolean {
    return this.config.provider === 'ollama';
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const url = `${this.config.baseURL}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    logger.debug(`Sending request to ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal as any,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('No response from LLM');
    }

    return {
      content: choice.message?.content || '',
      tool_calls: choice.message?.tool_calls,
      finish_reason: choice.finish_reason || 'stop',
      usage: data.usage,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this.isOllama()) {
        const ollamaBase = this.config.baseURL.replace('/v1', '');
        const response = await fetch(`${ollamaBase}/`, {
          timeout: 5000,
        } as any);
        return response.ok;
      } else {
        const response = await fetch(`${this.config.baseURL}/models`, {
          headers: this.getHeaders(),
          timeout: 5000,
        } as any);
        return response.ok;
      }
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      if (this.isOllama()) {
        const ollamaBase = this.config.baseURL.replace('/v1', '');
        const response = await fetch(`${ollamaBase}/api/tags`);
        if (!response.ok) return [];
        const data = (await response.json()) as any;
        return (data.models || []).map((m: any) => m.name);
      } else {
        const response = await fetch(`${this.config.baseURL}/models`, {
          headers: this.getHeaders(),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as any;
        return (data.data || []).map((m: any) => m.id);
      }
    } catch {
      return [];
    }
  }
}

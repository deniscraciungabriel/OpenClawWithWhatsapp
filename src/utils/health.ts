import fetch from 'node-fetch';
import { ConfigManager } from '../config/configManager';

export interface HealthResult {
  healthy: boolean;
  gateway: { status: string };
  llm: { status: string; provider: string; model: string };
  tools: { bash: boolean; browser: boolean; file: boolean };
  memory: { enabled: boolean; type: string };
  uptime: number;
}

export class HealthChecker {
  async check(): Promise<HealthResult> {
    const config = ConfigManager.load();
    let llmStatus = 'disconnected';

    try {
      const ollamaBase = config.llm.baseURL.replace('/v1', '');
      const response = await fetch(`${ollamaBase}/`, { timeout: 5000 } as any);
      if (response.ok) {
        llmStatus = 'connected';
      }
    } catch {
      llmStatus = 'unreachable';
    }

    return {
      healthy: llmStatus === 'connected',
      gateway: { status: 'running' },
      llm: {
        status: llmStatus,
        provider: config.llm.provider,
        model: config.llm.model,
      },
      tools: {
        bash: config.tools.bash.enabled,
        browser: config.tools.browser.enabled,
        file: config.tools.file.enabled,
      },
      memory: {
        enabled: config.memory.enabled,
        type: config.memory.type,
      },
      uptime: process.uptime(),
    };
  }
}

import { Command } from 'commander';
import { ConfigManager } from './config/configManager';
import { HealthChecker } from './utils/health';
import { LLMProvider } from './llm/llmProvider';
import { Logger } from './utils/logger';

const logger = Logger.create('cli');
const program = new Command();

program
  .name('openclaw-cli')
  .description('OpenClaw CLI management tool')
  .version('1.0.0');

program
  .command('status')
  .description('Show OpenClaw status')
  .action(async () => {
    const config = ConfigManager.load();
    const llm = new LLMProvider(config.llm);
    const connected = await llm.testConnection();

    console.log('OpenClaw Status');
    console.log('===============');
    console.log(`Gateway bind: ${config.gateway.bind}`);
    console.log(`Gateway port: ${config.gateway.port}`);
    console.log(`LLM provider: ${config.llm.provider}`);
    console.log(`LLM model: ${config.llm.model}`);
    console.log(`LLM base URL: ${config.llm.baseURL}`);
    console.log(`LLM connected: ${connected}`);
    console.log(`Memory: ${config.memory.enabled ? 'enabled' : 'disabled'} (${config.memory.type})`);
    console.log(`Tools - Bash: ${config.tools.bash.enabled}`);
    console.log(`Tools - Browser: ${config.tools.browser.enabled}`);
    console.log(`Tools - File: ${config.tools.file.enabled}`);
  });

program
  .command('health')
  .description('Check system health')
  .action(async () => {
    const checker = new HealthChecker();
    const result = await checker.check();

    console.log('Health Check');
    console.log('============');
    console.log(`Healthy: ${result.healthy}`);
    console.log(`Gateway: ${result.gateway.status}`);
    console.log(`LLM: ${result.llm.status} (${result.llm.provider}/${result.llm.model})`);
    console.log(`Uptime: ${Math.floor(result.uptime)}s`);

    process.exit(result.healthy ? 0 : 1);
  });

program
  .command('models')
  .description('Manage LLM models')
  .argument('[action]', 'Action: status, list')
  .action(async (action?: string) => {
    const config = ConfigManager.load();
    const llm = new LLMProvider(config.llm);

    if (action === 'status' || !action) {
      console.log(`Current model: ${config.llm.model}`);
      console.log(`Provider: ${config.llm.provider}`);
      console.log(`Base URL: ${config.llm.baseURL}`);

      const models = await llm.listModels();
      if (models.length > 0) {
        console.log('\nAvailable models:');
        for (const model of models) {
          const marker = model === config.llm.model ? ' (active)' : '';
          console.log(`  - ${model}${marker}`);
        }
      }
    }
  });

program
  .command('channels')
  .description('Manage messaging channels')
  .argument('[action]', 'Action: list, add, remove')
  .argument('[channel]', 'Channel name: telegram, whatsapp')
  .action(async (action?: string, channel?: string) => {
    const config = ConfigManager.load();

    switch (action) {
      case 'list':
      default:
        console.log('Configured channels:');
        if (config.channels.length === 0) {
          console.log('  No channels configured');
        } else {
          for (const ch of config.channels) {
            console.log(`  - ${ch.type} (${ch.name || ch.type})`);
          }
        }
        break;

      case 'add':
        if (!channel) {
          console.log('Usage: channels add <telegram|whatsapp>');
          return;
        }
        console.log(`To add ${channel}, update your openclaw.json channels array.`);
        console.log(`See documentation for ${channel} setup instructions.`);
        break;

      case 'remove':
        if (!channel) {
          console.log('Usage: channels remove <channel-name>');
          return;
        }
        config.channels = config.channels.filter(
          (c) => c.type !== channel && c.name !== channel
        );
        ConfigManager.save(config);
        console.log(`Channel ${channel} removed.`);
        break;
    }
  });

program
  .command('config')
  .description('Manage configuration')
  .argument('[action]', 'Action: show, path')
  .action(async (action?: string) => {
    const config = ConfigManager.load();

    switch (action) {
      case 'path':
        console.log(ConfigManager.getConfigPath() || 'No config file found');
        break;
      case 'show':
      default: {
        const display = { ...config };
        // Mask token for security
        if (display.gateway?.auth?.token) {
          display.gateway.auth.token = '***hidden***';
        }
        console.log(JSON.stringify(display, null, 2));
        break;
      }
    }
  });

program
  .command('logs')
  .description('Show recent logs')
  .action(async () => {
    console.log('Logs are available via: docker compose logs -f openclaw-gateway');
  });

program.parse();

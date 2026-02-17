import { GatewayServer } from './gateway/server';
import { ConfigManager } from './config/configManager';
import { Logger } from './utils/logger';
import { HealthChecker } from './utils/health';

const logger = Logger.create('main');

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'health') {
    const health = new HealthChecker();
    const result = await health.check();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.healthy ? 0 : 1);
  }

  logger.info('Starting OpenClaw...');

  const config = ConfigManager.load();
  logger.info(`Binding to ${config.gateway.bind}:${config.gateway.port}`);
  logger.info(`Connecting to LLM: ${config.llm.provider} at ${config.llm.baseURL}`);
  logger.info(`Model: ${config.llm.model}`);

  const server = new GatewayServer(config);

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  await server.start();
  logger.info(`Gateway ready at http://0.0.0.0:${config.gateway.port}`);
  logger.info('Health check: OK');
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});

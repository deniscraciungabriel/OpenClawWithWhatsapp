import { HealthChecker } from './utils/health';

async function main(): Promise<void> {
  const checker = new HealthChecker();
  const result = await checker.check();
  console.log(JSON.stringify(result));
  process.exit(result.healthy ? 0 : 1);
}

main().catch(() => process.exit(1));

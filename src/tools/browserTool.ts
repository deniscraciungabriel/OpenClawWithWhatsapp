import { Logger } from '../utils/logger';

const logger = Logger.create('browser-tool');

export interface BrowserToolConfig {
  enabled: boolean;
  headless?: boolean;
  timeout?: number;
}

export interface BrowseResult {
  url: string;
  title: string;
  content: string;
  status: number;
  error?: string;
}

export class BrowserTool {
  private config: BrowserToolConfig;
  private browser: any = null;

  constructor(config: BrowserToolConfig) {
    this.config = config;
  }

  async browse(url: string): Promise<BrowseResult> {
    if (!this.config.enabled) {
      return {
        url,
        title: '',
        content: 'Browser tool is disabled',
        status: 0,
        error: 'Browser tool is disabled',
      };
    }

    logger.info(`Browsing: ${url}`);

    try {
      const playwright = await import('playwright');

      if (!this.browser) {
        this.browser = await playwright.chromium.launch({
          headless: this.config.headless !== false,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      }

      const context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();
      page.setDefaultTimeout(this.config.timeout || 30000);

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
      });

      const title = await page.title();
      const content = await page.evaluate(`
        (() => {
          const body = document.body;
          if (!body) return '';
          const scripts = body.querySelectorAll('script, style, noscript');
          scripts.forEach(el => el.remove());
          return body.innerText || body.textContent || '';
        })()
      `);

      await context.close();

      return {
        url,
        title,
        content: content.substring(0, 50000), // Limit content length
        status: response?.status() || 0,
      };
    } catch (err: any) {
      logger.error(`Browser error: ${err.message}`);
      return {
        url,
        title: '',
        content: '',
        status: 0,
        error: err.message,
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

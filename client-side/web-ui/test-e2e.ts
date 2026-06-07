import puppeteer from 'puppeteer-core';

async function runTest() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const targetUrl = process.env.TEST_URL || 'http://localhost:5173';

  console.log(`[E2E Test] Launching Chrome from: ${chromePath}`);
  console.log(`[E2E Test] Connecting to frontend URL: ${targetUrl}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    console.log('[E2E Test] Navigating to page...');
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    console.log('[E2E Test] Preparing connection settings in localStorage...');
    const testConfig = await page.evaluate((env) => {
      if (env.CLAUDE_API_KEY) {
        localStorage.setItem('claude_api_key', env.CLAUDE_API_KEY);
      }
      if (env.CLAUDE_API_PROVIDER) {
        localStorage.setItem('claude_api_provider', env.CLAUDE_API_PROVIDER);
      }
      if (env.CLAUDE_MODEL) {
        localStorage.setItem('claude_model', env.CLAUDE_MODEL);
      }
      if (env.CLAUDE_BASE_URL) {
        localStorage.setItem('claude_base_url', env.CLAUDE_BASE_URL);
      }

      if (!localStorage.getItem('claude_ws_host')) {
        localStorage.setItem('claude_ws_host', 'localhost');
      }
      if (!localStorage.getItem('claude_ws_port')) {
        localStorage.setItem('claude_ws_port', '9800');
      }
      
      localStorage.setItem('claude_active_session_id', 'conv-e2e');
      localStorage.setItem('claude_display_name', 'e2e_test_user');

      return {
        provider: localStorage.getItem('claude_api_provider') || 'anthropic',
        model: localStorage.getItem('claude_model') || 'unknown',
        hasKey: !!localStorage.getItem('claude_api_key'),
        baseUrl: localStorage.getItem('claude_base_url') || 'default'
      };
    }, {
      CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || process.env.DEEPSEEK_API_KEY,
      CLAUDE_API_PROVIDER: process.env.CLAUDE_API_PROVIDER || (process.env.DEEPSEEK_API_KEY ? 'deepseek' : ''),
      CLAUDE_MODEL: process.env.CLAUDE_MODEL || (process.env.DEEPSEEK_API_KEY ? 'deepseek/deepseek-chat' : ''),
      CLAUDE_BASE_URL: process.env.CLAUDE_BASE_URL || (process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com' : '')
    });

    console.log(`[E2E Test] Target Connection Config:`);
    console.log(` - Provider: ${testConfig.provider}`);
    console.log(` - Model: ${testConfig.model}`);
    console.log(` - Base URL: ${testConfig.baseUrl}`);
    console.log(` - Has API Key: ${testConfig.hasKey}`);

    await page.reload({ waitUntil: 'networkidle2' });
    console.log('[E2E Test] Reloaded page to apply settings.');

    console.log('[E2E Test] Waiting for WebSocket connection status Connected...');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('connection-status');
        return el && el.textContent?.trim() === 'Connected';
      },
      { timeout: 15000 }
    );
    console.log('[E2E Test] WebSocket connection established successfully!');

    console.log('[E2E Test] Finding textarea and inputting question...');
    const textareaSelector = '#chat-textarea';
    await page.waitForSelector(textareaSelector);
    await page.type(textareaSelector, 'Who are you and what AI model is powering you? Please answer directly.');

    // 记录发送提问前已有的 assistant 消息内容
    const existingMessages = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const assistantHeaders = divs.filter(
        div => div.textContent === 'CLAUDE' && window.getComputedStyle(div).fontSize === '12px'
      );
      return assistantHeaders.map(header => {
        const bubble = header.nextElementSibling as HTMLElement;
        return bubble ? bubble.textContent?.trim() || '' : '';
      }).filter(Boolean);
    });
    console.log(`[E2E Test] Existing assistant messages before sending:`, existingMessages);

    console.log('[E2E Test] Clicking send button...');
    const sendButtonSelector = '#chat-send-button';
    await page.click(sendButtonSelector);

    console.log('[E2E Test] Question sent. Waiting for NEW AI response to render (max 45s)...');
    await page.waitForFunction(
      (oldMsgs) => {
        const divs = Array.from(document.querySelectorAll('div'));
        const assistantHeaders = divs.filter(
          div => div.textContent === 'CLAUDE' && window.getComputedStyle(div).fontSize === '12px'
        );
        for (const header of assistantHeaders) {
          const bubble = header.nextElementSibling as HTMLElement;
          if (!bubble) continue;
          const text = bubble.textContent?.trim() || '';
          if (text.length > 0 && !text.includes('is thinking') && !oldMsgs.includes(text)) {
            return true;
          }
        }
        return false;
      },
      { timeout: 45000 },
      existingMessages
    );

    const aiResponse = await page.evaluate((oldMsgs) => {
      const divs = Array.from(document.querySelectorAll('div'));
      const assistantHeaders = divs.filter(
        div => div.textContent === 'CLAUDE' && window.getComputedStyle(div).fontSize === '12px'
      );
      for (const header of assistantHeaders) {
        const bubble = header.nextElementSibling as HTMLElement;
        if (!bubble) continue;
        const text = bubble.textContent?.trim() || '';
        if (text.length > 0 && !text.includes('is thinking') && !oldMsgs.includes(text)) {
          return text;
        }
      }
      return '';
    }, existingMessages);

    console.log(`\n======================================================`);
    console.log(`[E2E TEST SUCCESS] NEW AI Reply Rendered Successfully!`);
    console.log(`AI Response Content: "${aiResponse}"`);
    console.log(`======================================================\n`);

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error(`\n======================================================`);
    console.error(`[E2E TEST FAILED] Error during testing:`);
    console.error(error);
    console.error(`======================================================\n`);
    
    await browser.close();
    process.exit(1);
  }
}

runTest();

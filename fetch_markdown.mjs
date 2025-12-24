#!/usr/bin/env node

// @raycast.schemaVersion 1
// @raycast.title Fetch Markdown
// @raycast.mode fullOutput
// @raycast.icon 🌐
// @raycast.packageName Developer Tools
// @raycast.argument1 {"type":"text","placeholder":"URLs (space separated)","optional":true}
// @raycast.author hassan_ahmed
// @raycast.authorURL https://raycast.com/hassan_ahmed

/**
 * DEPENDENCIES:
 *    npm install commander playwright clipboardy html-to-md p-limit @ghostery/adblocker-playwright
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { Command } from 'commander';
import { chromium } from 'playwright';
import clipboard from 'clipboardy';
import html2md from 'html-to-md';
import pLimit from 'p-limit';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';

// -----------------------
// Config (Colors)
// -----------------------
const BLUE = '\x1b[34m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', NC = '\x1b[0m';

// -----------------------
// Helpers
// -----------------------

function getTimestampFilename() {
  const now = new Date();
  return `markdown_${now.toISOString().replace(/[:.]/g, '-')}.md`;
}

function resolveOutputPath(fileName) {
  if (!fileName) {
      return path.join(os.homedir(), 'Downloads', getTimestampFilename());
  }
 
  return fileName;
}

async function resolveUrls(initialUrls) {
  let urls = (initialUrls || []).map(u => u.trim());

  // Check for single empty argument (often passed by Raycast if argument is empty)
  if (urls.length === 1 && urls[0] === '') {
    process.stderr.write(`${BLUE}Processing URLs from the clipboard...${NC}\n`);
    const clipboardContent = await clipboard.read();
    urls = clipboardContent.split('\n').map(url => url.trim()).filter(url => url);
  } else {
    // Filter out empty strings from arguments
    urls = urls.filter(u => u !== '');
  }

  // Interactive input if no URLs provided
  if (urls.length === 0) {
    process.stderr.write(`${YELLOW}Enter URLs (one per line). Press Ctrl-D when finished:${NC}\n`);
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
      if (line.trim()) urls.push(line.trim());
    }
  }

  return urls;
}

// -----------------------
// CLI Setup
// -----------------------
const program = new Command();
program
  .name('fetch-markdown')
  .description('Scrape URLs and convert them to Markdown (Parallel)')
  .argument('[urls...]', 'List of URLs to scrape')
  .option('-o, --output <file>', 'File to save the results to (optional)')
  .option('-c, --clipboard', 'Copy the final output to clipboard', true)
  .option('-p, --parallel <number>', 'Maximum parallel pages', '5')
  .parse(process.argv);

const options = program.opts();
const argUrls = program.args;
const argOutputFile = options.output;

// -----------------------
// Scraper Engine
// -----------------------
async function fetchContent(targetUrl, browser, counter, total) {
  process.stderr.write(`${BLUE}[${counter}/${total}]${NC} Starting: ${GREEN}${targetUrl}${NC}\n`);
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Initialize and enable adblocker
  const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
  await blocker.enableBlockingInPage(page);

  try {
    const isReddit = targetUrl.includes('reddit.com');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Initial scroll to bottom to trigger lazy loading
    // Scroll repeatedly until no new content or max attempts
    await page.evaluate(async () => {
        const distance = 1000;
        let lastHeight = document.body.scrollHeight;
        let retries = 0;
        while (retries < 5) {
            window.scrollBy(0, distance);
            await new Promise(r => setTimeout(r, 500));
            let newHeight = document.body.scrollHeight;
            if (newHeight === lastHeight) {
                retries++;
            } else {
                retries = 0;
                lastHeight = newHeight;
            }
        }
    });

    if (isReddit) {
        process.stderr.write(`${BLUE}Processing Reddit comments...${NC}\n`);
        
        // Phase 1: Expand main "View more comments" buttons sequentially
        while (true) {
          try {
            const viewMore = page.locator('button', { has: page.locator('span', { hasText: 'View more comments' }) }).first();
            if (!(await viewMore.isVisible())) break;
            
            process.stderr.write(`${BLUE}Expanding main threads...${NC}\n`);
            await viewMore.click({ timeout: 2000 });
            await page.waitForTimeout(2000);
          } catch (e) {
            break;
          }
        }

        // Phase 2: Expand all nested replies concurrently in batches (max 4 iterations)
        for (let i = 0; i < 5; i++) {
          try {
            const moreReplies = page.locator('faceplate-partial[src^="/svc/shreddit/more-comments/"] div:not([slot="loading"]) > button');
            const count = await moreReplies.count();
            if (count === 0) break;

            process.stderr.write(`${BLUE}Expanding ${count} nested replies...${NC}\n`);
            const buttons = await moreReplies.all();
            await Promise.all(buttons.map(b => b.click({ timeout: 2000 }).catch(() => {})));
            await page.waitForTimeout(2000);
          } catch (e) {
            break;
          }
        }
    }

    // DOM cleaning logic
    await page.evaluate((isRedditFlag) => {
      const redditSelectors = ['head', 'script', 'style', 'svg', 'img', 'reddit-header-large', 'flex-left-nav-container', '#right-sidebar-container', 'shreddit-async-loader', 'faceplate-loader', 'faceplate-partial', 'button', 'footer', '.legal-links', 'shreddit-comment-tree-ads', 'shreddit-dynamic-ad-link', '[slot="commentMeta"]', 'faceplate-timeago', 'shreddit-ad-post', '.promotedlink', 'faceplate-number', 'faceplate-tracker', '#shreddit-skip-link'];
      const generalSelectors = ['nav', 'header', 'footer', 'script', 'style', '.sidebar', '.ads', '.menu', 'img', 'svg', 'button', 'picture', 'video', 'audio', 'source', 'track', 'canvas'];
      const selectors = isRedditFlag ? redditSelectors : generalSelectors;

      const clean = (root) => {
        selectors.forEach(s => root.querySelectorAll(s).forEach(el => el.remove()));
        root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) clean(el.shadowRoot); });
      };
      clean(document);
    }, isReddit);

    // Use Playwright to get the cleaned body HTML
    const bodyHtml = await page.innerHTML('body');
    const markdown = html2md(bodyHtml);

    process.stderr.write(`${GREEN}✔ Finished:${NC} ${targetUrl}\n`);
    return { url: targetUrl, markdown, success: true };
  } catch (err) {
    process.stderr.write(`${RED}✘ Failed:${NC} ${targetUrl} (${err.message})\n`);
    return { url: targetUrl, success: false, error: err.message };
  } finally {
    await context.close();
  }
}

// -----------------------
// Main Execution
// -----------------------
(async () => {
  let finalUrls = await resolveUrls(argUrls);

  if (finalUrls.length === 0) {
    console.error(`${RED}Error: No URLs provided.${NC}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const limit = pLimit(parseInt(options.parallel || '5'));
  const tasks = finalUrls.map((u, i) => limit(() => fetchContent(u, browser, i + 1, finalUrls.length)));
  const results = await Promise.all(tasks);
  await browser.close();

  // Format and save output
  const outputData = results.map(res => 
    `================================================================\nURL: ${res.url}\n================================================================\n\n${res.success ? res.markdown : `ERROR: ${res.error}`}\n\n`
  ).join('');

  // Determine Output Path
  const finalOutputPath = resolveOutputPath(argOutputFile);

  fs.writeFileSync(finalOutputPath, outputData);
  process.stderr.write(`${GREEN}Done!${NC} Results saved to ${YELLOW}${finalOutputPath}${NC}\n`);

  if (options.clipboard) {
    await clipboard.write(outputData);
    process.stderr.write(`${BLUE}Results copied to clipboard.${NC}\n`);
  }
})();
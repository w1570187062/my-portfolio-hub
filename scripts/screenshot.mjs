#!/usr/bin/env node
/**
 * portfolio README 截图脚本 —— Playwright 版
 *
 * 替代 bash + bsk 的 shot-readme.sh：
 *   - 不依赖外部 daemon，playwright 自启动 Edge
 *   - 智能等待 (waitForSelector / networkidle) 替代固定 sleep
 *   - modal.screenshot() 精确截弹框，不再需要 isolate_modal hack
 *   - 配置驱动，每张图独立定义
 *
 * 用法：
 *   node scripts/screenshot.mjs                # 默认全部
 *   node scripts/screenshot.mjs home-light      # 只跑指定名称
 *   SHOT_URL=http://localhost:8080 node scripts/screenshot.mjs
 *
 * 依赖：npm i -D playwright && npx playwright install msedge
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'docs/screenshots');
const TARGET = process.env.SHOT_URL || 'http://192.168.31.254:9989';
const VIEWPORT = { width: 1500, height: 900 };
const TIMEOUT = 20_000;

mkdirSync(OUT_DIR, { recursive: true });

// ---------- 工具 ----------
async function applyTheme(page, theme, accent) {
  await page.evaluate(
    ({ theme, accent }) => {
      localStorage.setItem('pf_theme', theme);
      localStorage.setItem('pf_accent', accent);
      localStorage.setItem('pf_user', '1');
      document.documentElement.dataset.theme = theme;
      if (typeof applyTheme === 'function') applyTheme(theme);
      if (typeof applyAccent === 'function') applyAccent(accent);
    },
    { theme, accent }
  );
}

// ---------- 截图配置 ----------
// open:  JS 字符串(在 page.evaluate 中运行) 或 async (page)=>{...}
// ready: CSS selector，出现且可见后才算渲染完成
// modal: 如果提供，则只截该元素(弹框)而不是整页
const SHOTS = [
  // ===== 整页类 =====
  {
    name: 'home-light', route: '#/holdings', theme: 'light', accent: 'gold',
    ready: '.holdings-subtable tbody tr',
  },
  {
    name: 'home-dark', route: '#/holdings', theme: 'dark', accent: 'gold',
    ready: '.holdings-subtable tbody tr',
  },
  {
    name: 'asset', route: '#/asset', theme: 'light', accent: 'gold',
    ready: '#assetTabBody',
    waitFor: async (page) => {
      await page.locator('#assetView').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('#assetTabBody').waitFor({ state: 'visible', timeout: TIMEOUT });
      // 等待至少一组 tab body children 渲染
      await page.waitForFunction(
        () => document.querySelector('#assetTabBody')?.children.length > 0,
        { timeout: TIMEOUT }
      );
    },
  },
  {
    name: 'rebalance', route: '#/tools', theme: 'light', accent: 'gold',
    waitFor: async (page) => {
      // 先切到再平衡 tab
      const tab = page.locator('.ana-tab-btn[data-tab="rebal"]');
      if (await tab.count()) {
        await tab.click();
      } else {
        // 兼容文本按钮形态
        await page.getByRole('button', { name: /再平衡|rebal/i }).click().catch(() => {});
      }
      await page.locator('#tlPanelRebal').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.waitForFunction(
        () => document.querySelector('#tlPanelRebal')?.children.length > 0,
        { timeout: TIMEOUT }
      );
    },
  },

  // ===== 弹框类 =====
  {
    name: 'calendar-pnl', route: '#/holdings', theme: 'light', accent: 'gold',
    modal: '#pnlModal',
    open: () => document.getElementById('pnlCalBtn')?.click(),
    waitFor: async (page) => {
      await page.locator('#calGrid .cal-cell').first().waitFor({ state: 'visible', timeout: TIMEOUT });
    },
  },
  {
    name: 'analysis', route: '#/holdings', theme: 'light', accent: 'gold',
    modal: '#analysisModal',
    open: async (page) => {
      // 取第一个非清仓行的 data-ana 值，直接调 openAnalysis(id)
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('tr')].find(
          (r) => !r.classList.contains('holding-archived') && r.querySelector('[data-ana]')
        );
        if (!row) { document.title = 'NO_ROW'; return; }
        const id = row.querySelector('[data-ana]').getAttribute('data-ana');
        if (typeof openAnalysis === 'function') openAnalysis(id);
        else document.title = 'NO_FN';
      });
    },
    waitFor: async (page) => {
      await page.locator('#analysisModal').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.waitForFunction(
        () => {
          const m = document.getElementById('analysisModal');
          if (!m || m.hidden) return false;
          const body = document.getElementById('analysisBody');
          return !!(body && body.innerText.trim().length > 10);
        },
        { timeout: TIMEOUT }
      );
    },
  },
  {
    name: 'wealth-update', route: '#/holdings', theme: 'light', accent: 'gold',
    modal: '#snapModal',
    open: () => document.getElementById('wealthSnapBtn')?.click(),
    waitFor: async (page) => {
      await page.locator('#snapModal').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.waitForFunction(
        () => {
          const m = document.getElementById('snapModal');
          if (!m || m.hidden) return false;
          const b = document.getElementById('snapBody');
          return !!(b && (b.querySelector('.snap-row') || b.innerText.trim().length > 20));
        },
        { timeout: TIMEOUT }
      );
    },
  },
  {
    name: 'buy-plan', route: '#/holdings', theme: 'light', accent: 'gold',
    modal: '#guideModal',
    open: () => document.getElementById('guideBtn')?.click(),
    waitFor: async (page) => {
      await page.locator('#guideModal').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.waitForFunction(
        () => {
          const m = document.getElementById('guideModal');
          if (!m || m.hidden) return false;
          const b = document.getElementById('guidePlanBody');
          if (!b) return false;
          return !!(b.querySelector('.bp-card') || b.querySelector('.guide-empty'));
        },
        { timeout: TIMEOUT }
      );
    },
  },
  // 收支计划编辑：资产页 → 收支 tab → 编辑按钮
  {
    name: 'cashflow-plan', route: '#/asset', theme: 'light', accent: 'gold',
    modal: '#cashflowModal',
    waitFor: async (page) => {
      await page.locator('#assetView').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('#assetTabBody').waitFor({ state: 'visible', timeout: TIMEOUT });
      // 点「收支」tab
      const tab = page.locator('.ana-tab-btn[data-tab="cash"]');
      if (await tab.count()) {
        await tab.click();
      } else {
        await page.getByRole('button', { name: /^收支$/ }).click().catch(() => {});
      }
      // 等编辑按钮出现（多条记录，取第一个）
      await page.locator('button[data-act="cf-edit2"]').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('button[data-act="cf-edit2"]').first().click();
      await page.locator('#cashflowModal').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.waitForFunction(
        () => {
          const m = document.getElementById('cashflowModal');
          if (!m || m.hidden) return false;
          const c = m.querySelector('.modal-card');
          return !!(c && c.offsetHeight > 0 && c.innerText.trim().length > 3);
        },
        { timeout: TIMEOUT }
      );
    },
  },

  // ===== AI 助手：全屏视口截图 =====
  {
    name: 'ai-assistant', route: '#/holdings', theme: 'light', accent: 'gold',
    waitFor: async (page) => {
      await page.locator('#holdingsView').waitFor({ state: 'visible', timeout: TIMEOUT });
      // 点 AI 悬浮按钮
      await page.locator('.ai-fab').click();
      await page.locator('#aiChatPanel').waitFor({ state: 'visible', timeout: TIMEOUT });
      // 模拟全屏：直接改样式让 panel 覆盖整个视口
      await page.evaluate(() => {
        const p = document.getElementById('aiChatPanel');
        if (!p) return;
        Object.assign(p.style, {
          position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
          width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none',
          margin: '0', borderRadius: '0', zIndex: '2147483647', boxShadow: 'none',
        });
      });
    },
    fullPage: false, // AI 全屏用视口尺寸即可
  },
];

// ---------- 单张截图执行 ----------
async function runShot(browserContext, shot) {
  const page = await browserContext.newPage();
  try {
    console.log(`=> ${shot.name}  (${shot.route}, ${shot.theme}/${shot.accent})`);
    await page.goto(`${TARGET}/${shot.route}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // 应用主题 + 重载（确保初始化脚本读到 localStorage）
    await applyTheme(page, shot.theme, shot.accent);
    await page.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });

    // open hook
    if (shot.open) {
      if (typeof shot.open === 'function' && shot.open.constructor.name === 'AsyncFunction') {
        await shot.open(page);
      } else if (typeof shot.open === 'function') {
        // 普通函数：可能是 JS 字符串形式
        await page.evaluate(shot.open);
      } else {
        await page.evaluate(shot.open);
      }
    }

    // waitFor hook
    if (shot.waitFor) {
      if (typeof shot.waitFor === 'function') {
        await shot.waitFor(page);
      }
    } else if (shot.ready) {
      await page.locator(shot.ready).first().waitFor({ state: 'visible', timeout: TIMEOUT });
    }

    // 额外给一个渲染缓冲，让 CSS 动画/过渡稳定
    await page.waitForTimeout(300);

    const path = resolve(OUT_DIR, `${shot.name}.png`);
    if (shot.modal) {
      const el = page.locator(shot.modal);
      await el.waitFor({ state: 'visible', timeout: TIMEOUT });
      await el.screenshot({ path });
    } else {
      await page.screenshot({ path, fullPage: shot.fullPage !== false });
    }

    const bytes = statSync(path).size;
    console.log(`   已保存 ${path} (${bytes} bytes)`);
  } finally {
    await page.close();
  }
}

// ---------- 主流程 ----------
async function main() {
  const filter = process.argv[2];
  const list = filter ? SHOTS.filter((s) => s.name === filter) : SHOTS;
  if (list.length === 0) {
    console.error(filter ? `未找到名为 "${filter}" 的截图配置` : '无截图配置');
    process.exit(1);
  }

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });

  const failed = [];
  for (const shot of list) {
    try {
      await runShot(context, shot);
    } catch (err) {
      console.error(`   ✗ ${shot.name} 失败: ${err.message}`);
      failed.push({ name: shot.name, err });
    }
  }

  await context.close();
  await browser.close();

  console.log(`\n完成。输出目录：${OUT_DIR}`);
  if (failed.length > 0) {
    console.error(`\n失败 ${failed.length} 张:`);
    failed.forEach((f) => console.error(`  - ${f.name}: ${f.err.message}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('致命错误:', e);
  process.exit(1);
});

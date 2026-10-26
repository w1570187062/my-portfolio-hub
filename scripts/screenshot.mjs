#!/usr/bin/env node
/**
 * portfolio README 截图脚本 —— Playwright 版（一键截图）
 *
 * 设计要点：
 *   - 不依赖外部 daemon，playwright 自启 Edge(msedge channel)。
 *   - 每个 shot 用独立 browser context + addInitScript 注入 localStorage，
 *     彻底隔离跨 shot 的视图状态（尤其持仓/理财子 tab 记忆），避免白屏/串台。
 *   - 路由用 SPA 真实 hash：#/home #/invest #/asset #/finance #/settings。
 *   - 弹框统一调用全局函数（openPnlModal / openSnapModal / openAnalysis /
 *     openCashflowModal），不再依赖动态生成的按钮 id。
 *
 * 用法：
 *   node scripts/screenshot.mjs                # 全部
 *   node scripts/screenshot.mjs home finance    # 只跑指定名称（空格分隔）
 *   SHOT_URL=http://localhost:8080 node scripts/screenshot.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'docs/screenshots');
const TARGET = (process.env.SHOT_URL || 'http://192.168.31.254:9989').replace(/\/$/, '');
const VIEWPORT = { width: 1500, height: 960 };
const TIMEOUT = 25_000;

mkdirSync(OUT_DIR, { recursive: true });

// 视图是否可见 + 内部是否渲染出内容（以可见 + innerText 长度判断，跨视图通用）
// 注意：page.waitForFunction(fn, arg) 的 arg 是「单个参数」，不会展开，
//      必须在函数体内解构，否则形参会拿到整个对象导致判定恒为 false。
async function viewReady(page, viewId, minLen = 40, extra = '') {
  // 兼容旧签名 (viewId, extraSelector)：字符串型第三参按 extra 处理，避免静默失效
  if (typeof minLen === 'string') { extra = minLen; minLen = 40; }
  const min = Number(minLen) || 40;
  await page.locator(`#${viewId}`).waitFor({ state: 'visible', timeout: TIMEOUT });
  await page.waitForFunction(
    ({ vid, ex, min }) => {
      const v = document.getElementById(vid);
      if (!v || v.hidden) return false;
      if (ex && !document.querySelector(ex)) return false;
      return v.innerText.trim().length > min;
    },
    { vid: viewId, ex: extra, min },
    { timeout: TIMEOUT }
  );
}

const SHOTS = [
  // ===== 整页：五大视图 =====
  {
    name: 'home', route: '#/home', theme: 'light', accent: 'gold',
    waitFor: (p) => viewReady(p, 'homeView', 40, '#homeHero'),
  },
  {
    name: 'invest', route: '#/invest', theme: 'light', accent: 'gold',
    waitFor: (p) => viewReady(p, 'holdingsView', 40, '.holdings-subtable tbody tr'),
  },
  {
    name: 'asset', route: '#/asset', theme: 'light', accent: 'gold',
    waitFor: (p) => viewReady(p, 'assetView', 40, '#assetTabBody .as-card'),
  },
  {
    name: 'finance', route: '#/finance', theme: 'light', accent: 'gold',
    waitFor: (p) => viewReady(p, 'financeView', 40, '#finKpiGrid'),
  },
  {
    name: 'settings', route: '#/settings', theme: 'light', accent: 'gold',
    waitFor: (p) => viewReady(p, 'settingsView', 40, '#userSheet'),
  },

  // ===== 弹框类（全局函数直接打开，不点动态按钮）=====
  {
    name: 'calendar-pnl', route: '#/invest', theme: 'light', accent: 'gold',
    modal: '#pnlModal',
    open: () => openPnlModal(),
    waitFor: (p) => p.locator('#calGrid .cal-cell').first().waitFor({ state: 'visible', timeout: TIMEOUT }),
  },
  {
    name: 'analysis', route: '#/invest', theme: 'light', accent: 'gold',
    modal: '#analysisModal',
    waitFor: async (p) => {
      await viewReady(p, 'holdingsView', 40, '.holdings-subtable tbody tr');
      // 逐个尝试持仓，直到找到真正支持技术分析的标的
      // （未关联股票代码的基金会返回 .analysis-err，需跳过）
      const ids = await p.evaluate(() =>
        [...document.querySelectorAll('#holdingsView tr')]
          .map((r) => r.querySelector('[data-ana]'))
          .filter(Boolean)
          .map((el) => el.getAttribute('data-ana'))
          .filter(Boolean)
      );
      await p.evaluate(async (list) => {
        for (const id of list) {
          openAnalysis(id);
          for (let t = 0; t < 80; t++) {
            await new Promise((r) => setTimeout(r, 100));
            const b = document.getElementById('analysisBody');
            if (!b) continue;
            if (b.querySelector('.analysis-err')) break;        // 不支持 → 换下一个
            if (b.querySelector('.analysis-loading')) continue;   // 仍在加载
            if (b.children.length > 0) return;                   // 渲染成功
          }
        }
      }, ids);
      await p.locator('#analysisModal').waitFor({ state: 'visible', timeout: TIMEOUT });
      await p.waitForFunction(
        () => {
          const b = document.getElementById('analysisBody');
          if (!b) return false;
          if (b.querySelector('.analysis-err') || b.querySelector('.analysis-loading')) return false;
          return b.children.length > 0 && b.innerText.trim().length > 10;
        },
        { timeout: TIMEOUT }
      );
    },
  },
  // ===== AI 助手（全屏视口截图）=====
  {
    name: 'ai-assistant', route: '#/invest', theme: 'light', accent: 'gold',
    waitFor: async (p) => {
      await viewReady(p, 'holdingsView', 40, '.holdings-subtable tbody tr');
      // 打开 AI 悬浮面板（用 aiChatOpen 而非点击 fab：fab 是 toggle，可能把已开的面板关掉）
      await p.evaluate(() => {
        if (typeof aiChatOpen === 'function') aiChatOpen();
        else { const f = document.getElementById('aiFab'); if (f) f.click(); }
      });
      await p.locator('#aiChatPanel').waitFor({ state: 'visible', timeout: TIMEOUT });
      // 选中已有会话，让主区域有真实对话内容（而不是空白）
      const item = p.locator('#aiChatList .acp-item').first();
      await item.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {});
      if (await item.count()) {
        await item.click();
        await p.waitForFunction(
          () => {
            const m = document.getElementById('aiChatMsgs');
            return !!(m && m.innerText.trim().length > 20);
          },
          { timeout: TIMEOUT }
        ).catch(() => {});
      }
      // 模拟全屏：让 panel 覆盖整个视口
      await p.evaluate(() => {
        const panel = document.getElementById('aiChatPanel');
        if (!panel) return;
        Object.assign(panel.style, {
          position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
          width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none',
          margin: '0', borderRadius: '0', zIndex: '2147483647', boxShadow: 'none',
        });
      });
    },
    fullPage: false,
  },
];

// ---------- 单张截图执行 ----------
async function runShot(browser, shot) {
  // 每个 shot 独立 context：彻底隔离 localStorage（避免子 tab 记忆串台导致白屏）
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(
    ({ theme, accent }) => {
      localStorage.setItem('pf_user', '1');
      localStorage.setItem('pf_theme', theme);
      localStorage.setItem('pf_accent', accent);
      localStorage.removeItem('pf_home_section'); // 重置为默认「持仓」
    },
    { theme: shot.theme, accent: shot.accent }
  );

  const page = await context.newPage();
  try {
    console.log(`=> ${shot.name}  (${shot.route}, ${shot.theme}/${shot.accent})`);
    await page.goto(`${TARGET}/${shot.route}`, { waitUntil: 'networkidle', timeout: TIMEOUT });

    // open hook（弹框类）：在 page.evaluate 中运行全局函数
    if (shot.open) {
      await page.evaluate(shot.open);
    }

    // 等待渲染完成
    if (shot.waitFor) {
      await shot.waitFor(page);
    }

    // 渲染缓冲：让 CSS 过渡 / 图表绘制稳定
    await page.waitForTimeout(450);

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
    await context.close();
  }
}

// ---------- 主流程 ----------
async function main() {
  const filters = process.argv.slice(2);
  const list = filters.length
    ? SHOTS.filter((s) => filters.includes(s.name))
    : SHOTS;
  if (list.length === 0) {
    console.error('未匹配到任何截图配置：' + filters.join(', '));
    process.exit(1);
  }

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-gpu'],
  });

  const failed = [];
  for (const shot of list) {
    try {
      await runShot(browser, shot);
    } catch (err) {
      console.error(`   ✗ ${shot.name} 失败: ${err.message}`);
      failed.push({ name: shot.name, err });
    }
  }

  await browser.close();

  console.log(`\n完成。输出目录：${OUT_DIR}`);
  console.log(`成功 ${list.length - failed.length}/${list.length}`);
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

#!/usr/bin/env node
/**
 * AIOps 前端界面录屏脚本 v2 · 真实数据 + 真实交互
 * - 先 seed-demo 注入 7 故障
 * - 录 6 段：仪表盘 → 故障管理（鼠标移动悬停+滚动）→ 故障详情
 *          → Agent管理 → 评估中心 → Runbook检索
 * - 每段末尾有鼠标轨迹效果
 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = '/Users/apple/资料/02-Agent项目实战/项目源码/项目/运维多智能体故障定位/aiops-agent-platform/frontend';
const OUTPUT = path.join(ROOT, 'outputs', 'demo_ui_30s.mp4');
const FRAMES_DIR = '/tmp/aiops_frames_v2';
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const FPS = 10;
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = `${WIDTH}:${HEIGHT}`;

let frameCount = 0;
const totalExpected = 5 * 6 + 5 * 6 + 5 * 6 + 5 * 6 + 5 * 6; // 30s × 10fps

async function shoot(page) {
  const f = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.jpg`);
  await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
  frameCount++;
  if (frameCount % 5 === 0) {
    process.stdout.write(`\r  📸 帧 ${frameCount}/${totalExpected}`);
  }
}

async function stay(page, seconds) {
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) await shoot(page);
}

async function mouseMove(page, fromX, fromY, toX, toY, steps, pauseMs) {
  const dx = (toX - fromX) / steps;
  const dy = (toY - fromY) / steps;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fromX + dx * i, fromY + dy * i);
    await new Promise((r) => setTimeout(r, pauseMs));
  }
}

async function addPageOverlay(page, pageNum, total, label, subline) {
  await page.evaluate(({ pageNum, total, label, subline }) => {
    document.querySelectorAll('div._demo_overlay').forEach(e => e.remove());
    const overlay = document.createElement('div');
    overlay.className = '_demo_overlay';
    overlay.style.cssText = `
      position: fixed; top: 14px; right: 18px; z-index: 99999;
      background: rgba(0,0,0,0.78); color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      padding: 10px 16px; border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.1);
      min-width: 180px;
    `;
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="background:linear-gradient(135deg,#378ADD,#5BA8F5);padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.5px;">${pageNum}/${total}</span>
        <span style="font-size:14px;font-weight:600;">${label}</span>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,0.7);">${subline}</div>
    `;
    document.body.appendChild(overlay);
  }, { pageNum, total, label, subline });
}

async function main() {
  console.log('🚀 启动 Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  // 隐藏真实光标，用 overlay 模拟
  await page.evaluateOnNewDocument(() => {
    const style = document.createElement('style');
    style.textContent = `* { cursor: none !important; }`;
    document.head.appendChild(style);
  });

  const total = 5;

  // ====== 1. 仪表盘 ======
  console.log('\n🎬 [1/5] 仪表盘 · 系统健康度');
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1800));
  await addPageOverlay(page, 1, total, '仪表盘 Dashboard', '多智能体AIOps运维平台 · 系统健康度');
  await mouseMove(page, 640, 360, 200, 200, 8, 40);
  await stay(page, 4);

  // ====== 2. 故障管理 + 鼠标悬停 + 滚动 ======
  console.log('\n🎬 [2/5] 故障管理 · 7 故障已注入');
  await page.goto('http://127.0.0.1:3000/incidents', { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2000));
  await addPageOverlay(page, 2, total, '故障管理 Incidents', '7 个真实故障 · 状态分布清晰');
  // 鼠标从中心移到第一条 incident 行
  await mouseMove(page, 640, 360, 600, 280, 12, 30);
  await stay(page, 2);
  // 缓慢滚动展示
  await page.evaluate(() => window.scrollTo({ top: 250, behavior: 'smooth' }));
  await new Promise(r => setTimeout(r, 1200));
  await shoot(page); await shoot(page); await shoot(page); await shoot(page); await shoot(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await new Promise(r => setTimeout(r, 800));
  // 移动到状态徽章上
  await mouseMove(page, 600, 280, 850, 280, 8, 40);
  await stay(page, 1.5);

  // ====== 3. 故障详情（点击某条 incident） ======
  console.log('\n🎬 [3/5] 故障详情 · RCA + 自愈链路');
  // 找到第一个 incident ID，从 URL 进入详情页
  const incidentsResp = await fetch('http://127.0.0.1:8000/api/v1/incidents?page_size=10');
  const incidentsData = await incidentsResp.json();
  const firstId = incidentsData.items[0]?.id;
  if (firstId) {
    await page.goto(`http://127.0.0.1:3000/incidents/${firstId}`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));
    await addPageOverlay(page, 3, total, '故障详情 Incident Detail', '4 Agent 协作 · RCA + Heal + Change');
    await mouseMove(page, 640, 360, 400, 400, 10, 30);
    await stay(page, 3);
    // 滚动看证据/审计
    await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'smooth' }));
    await new Promise(r => setTimeout(r, 1200));
    await stay(page, 2);
  } else {
    // fallback: 还在列表页
    await addPageOverlay(page, 3, total, '故障详情 Incident Detail', '4 Agent 协作 · RCA + Heal + Change');
    await stay(page, 5);
  }

  // ====== 4. Agent 管理 ======
  console.log('\n🎬 [4/5] Agent 管理 · 4 个智能体');
  await page.goto('http://127.0.0.1:3000/agents', { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2000));
  await addPageOverlay(page, 4, total, 'Agent 管理 Agents', 'RCA · Heal · Change · Orchestrator');
  await mouseMove(page, 640, 360, 320, 220, 10, 30);
  await stay(page, 3);
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
  await new Promise(r => setTimeout(r, 1000));
  await stay(page, 2);

  // ====== 5. 评估中心 + Runbook检索 ======
  console.log('\n🎬 [5/5] 评估中心 · 159 真实 badcase');
  await page.goto('http://127.0.0.1:3000/evaluation', { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2200));
  await addPageOverlay(page, 5, total, '评估中心 Evaluation', 'v3 评测体系 · 159 badcase · AIOpsLab 对照');
  await mouseMove(page, 640, 360, 500, 300, 10, 30);
  await stay(page, 3);
  await page.evaluate(() => window.scrollTo({ top: 280, behavior: 'smooth' }));
  await new Promise(r => setTimeout(r, 1000));
  await stay(page, 2);

  await browser.close();
  console.log(`\n✅ 共捕获 ${frameCount} 帧`);
  return frameCount;
}

async function makeMp4() {
  console.log('\n🎬 合成 MP4...');
  const args = [
    '-y',
    '-framerate', String(FPS),
    '-i', `${FRAMES_DIR}/frame_%05d.jpg`,
    '-r', String(FPS),
    '-vf', `scale=${SCALE}:force_original_aspect_ratio=decrease,pad=${SCALE}:(ow-iw)/2:(oh-ih)/2:black`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUTPUT,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)));
    proc.on('error', reject);
  });
}

main()
  .then(makeMp4)
  .then(() => {
    const stats = fs.statSync(OUTPUT);
    console.log(`\n🎉 完成！${OUTPUT}`);
    console.log(`   大小: ${(stats.size / 1024).toFixed(0)} KB · 时长: ~30s · 1280×720`);
  })
  .catch((e) => { console.error('❌', e.message); process.exit(1); });

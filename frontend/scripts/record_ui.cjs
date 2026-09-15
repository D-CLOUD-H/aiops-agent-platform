#!/usr/bin/env node
/**
 * AIOps 前端界面录屏脚本
 * 录制 5 个核心页面，合成 mp4
 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = '/Users/apple/资料/02-Agent项目实战/项目源码/项目/运维多智能体故障定位/aiops-agent-platform/frontend';
const OUTPUT = path.join(ROOT, 'outputs', 'demo_ui_30s.mp4');
const FRAMES_DIR = '/tmp/aiops_frames';

// 确保输出目录存在
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

// 5 个页面路由 + 停留秒数
const PAGES = [
  { url: 'http://127.0.0.1:3000/', label: '仪表盘', duration: 5 },
  { url: 'http://127.0.0.1:3000/incidents', label: '故障管理', duration: 6 },
  { url: 'http://127.0.0.1:3000/agents', label: 'Agent管理', duration: 5 },
  { url: 'http://127.0.0.1:3000/evaluation', label: '评估中心', duration: 5 },
  { url: 'http://127.0.0.1:3000/runbooks/search', label: 'Runbook检索', duration: 5 },
];

const FPS = 10; // 10fps 足够流畅
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = `${WIDTH}:${HEIGHT}`;

async function captureScreenshots() {
  console.log('🚀 启动 Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  let frameCount = 0;

  for (let i = 0; i < PAGES.length; i++) {
    const { url, label, duration } = PAGES[i];
    console.log(`📸 [${i + 1}/${PAGES.length}] 访问 ${label} (${url})，停留 ${duration}s...`);

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
    // 额外等渲染
    await new Promise((r) => setTimeout(r, 1500));

    // 在页面顶部注入标题水印（用 canvas overlay）
    await page.evaluate(({ label, pageNum, total }) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; top: 12px; right: 16px; z-index: 99999;
        background: rgba(0,0,0,0.75); color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        font-size: 13px; padding: 6px 14px; border-radius: 8px;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      `;
      overlay.innerHTML = `
        <span style="background:#378ADD;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">PAGE ${pageNum}/${total}</span>
        <span>${label}</span>
      `;
      document.body.appendChild(overlay);
    }, { label, pageNum: i + 1, total: PAGES.length });

    // 截图并等待
    const frames = duration * FPS;
    for (let f = 0; f < frames; f++) {
      const frameFile = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.jpg`);
      await page.screenshot({ path: frameFile, type: 'jpeg', quality: 85 });
      frameCount++;
      process.stdout.write(`\r  帧 ${frameCount}/${PAGES.reduce((s, p) => s + p.duration * FPS, 0)}`);
      await new Promise((r) => setTimeout(r, 1000 / FPS));
    }
    console.log();
  }

  await browser.close();
  console.log(`✅ 共捕获 ${frameCount} 帧`);
  return frameCount;
}

async function makeMp4(totalFrames) {
  console.log('\n🎬 合成 MP4 (ffmpeg)...');
  // ffmpeg: -framerate 输入帧率 -> -r 输出帧率 -> scale -> h264
  const args = [
    '-y', // 覆盖
    '-framerate', String(FPS),
    '-i', `${FRAMES_DIR}/frame_%05d.jpg`,
    '-r', String(FPS),
    '-vf', `scale=${SCALE}:force_original_aspect_ratio=decrease,pad=${SCALE}:(ow-iw)/2:(oh-ih)/2:black`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUTPUT,
  ];
  console.log('ffmpeg', args.join(' '));

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed: ${code}\n${stderr}`));
      }
    });
    proc.on('error', reject);
  });
}

async function main() {
  const totalFrames = await captureScreenshots();
  await makeMp4(totalFrames);
  console.log(`\n🎉 完成！文件: ${OUTPUT}`);
  const stats = fs.statSync(OUTPUT);
  console.log(`   大小: ${(stats.size / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});

const puppeteer = require('/tmp/puppeteer-install/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_DIR = '/Users/apple/资料/02-Agent项目实战/项目源码/项目/运维多智能体故障定位/aiops-agent-platform/scripts';
const PLAYER_URL = 'file://' + path.join(SCRIPT_DIR, 'demo_30s_player.html');
const OUTPUT = path.join(SCRIPT_DIR, 'demo_30s.mp4');
const FRAME_DIR = '/tmp/demo_frames';

(async () => {
  console.log('Launching Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 }
  });

  const page = await browser.newPage();
  await page.goto(PLAYER_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  if (fs.existsSync(FRAME_DIR)) execSync('rm -rf ' + FRAME_DIR);
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  console.log('Click Play + capture frames at 10fps for 32s...');
  await page.click('#playBtn');

  const FPS = 10;
  const DURATION_MS = 32000;
  const INTERVAL = 1000 / FPS;
  const totalFrames = Math.floor(DURATION_MS / INTERVAL);

  for (let i = 0; i < totalFrames; i++) {
    const start = Date.now();
    const buf = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
    fs.writeFileSync(path.join(FRAME_DIR, 'frame_' + String(i).padStart(5, '0') + '.jpg'), buf);
    if (i % 30 === 0) console.log('  frames: ' + i + '/' + totalFrames);
    const elapsed = Date.now() - start;
    if (elapsed < INTERVAL) await new Promise(r => setTimeout(r, INTERVAL - elapsed));
  }

  console.log('Captured ' + totalFrames + ' frames');
  await browser.close();

  console.log('Encoding mp4...');
  execSync('ffmpeg -y -framerate ' + FPS + ' -i "' + FRAME_DIR + '/frame_%05d.jpg" -c:v libx264 -pix_fmt yuv420p -crf 23 -vf "scale=1280:720" -movflags +faststart "' + OUTPUT + '"', { stdio: 'inherit' });

  console.log('Done: ' + OUTPUT);
  console.log('Size: ' + (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2) + ' MB');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

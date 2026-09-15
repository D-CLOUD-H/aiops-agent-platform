#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/apple/资料/02-Agent项目实战/项目源码/项目/运维多智能体故障定位/aiops-agent-platform/frontend';
const OUT = path.join(ROOT, 'outputs', 'cpu_alert_full_flow_30s.mp4');
const FRAMES = '/tmp/aiops_cpu_flow_frames';
const FPS = 10, W = 1280, H = 720;
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
let frame = 0;

const wait = ms => new Promise(r => setTimeout(r, ms));
async function shot(page) {
  await page.screenshot({ path: path.join(FRAMES, `frame_${String(frame++).padStart(5,'0')}.jpg`), type:'jpeg', quality:88 });
}
async function hold(page, sec) { for(let i=0;i<Math.round(sec*FPS);i++){await shot(page); await wait(1000/FPS);} }
async function caption(page, title, body, phase) {
  await page.evaluate(({title, body, phase}) => {
    document.querySelectorAll('#record-caption').forEach(x=>x.remove());
    const el=document.createElement('div'); el.id='record-caption';
    el.style.cssText='position:fixed;left:28px;right:28px;bottom:22px;z-index:99999;background:rgba(8,15,30,.94);border:1px solid rgba(96,165,250,.55);border-left:5px solid #38bdf8;border-radius:10px;padding:12px 18px;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45);';
    el.innerHTML=`<div style="display:flex;align-items:center;gap:10px"><span style="font-size:11px;color:#7dd3fc;letter-spacing:1px;font-weight:700">${phase}</span><span style="font-size:16px;font-weight:700">${title}</span></div><div style="font-size:13px;line-height:1.55;margin-top:4px;color:#cbd5e1">${body}</div>`;
    document.body.appendChild(el);
  }, {title, body, phase});
}
async function overlay(page, text) {
  await page.evaluate(text=>{document.querySelectorAll('#record-mark').forEach(x=>x.remove());const e=document.createElement('div');e.id='record-mark';e.textContent=text;e.style.cssText='position:fixed;top:14px;right:18px;z-index:99998;background:rgba(15,23,42,.85);color:#bae6fd;border:1px solid rgba(56,189,248,.4);padding:6px 12px;border-radius:7px;font:600 11px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;letter-spacing:.6px';document.body.appendChild(e)}, text);
}
async function clickText(page, text, nth=0) {
  const els = await page.$$('button');
  let found=0;
  for(const el of els){const t=await el.evaluate(e=>e.innerText.trim()); if(t.includes(text)){if(found++===nth){await el.click();return true;}}}
  return false;
}
async function selectCpuAndTrigger(page) {
  await clickText(page, '注入故障'); await wait(500);
  // click the CPU scenario card or label
  const clicked = await page.evaluate(() => {
    const all=[...document.querySelectorAll('button, [role="button"], label, div')];
    const el=all.find(x=>x.innerText && x.innerText.includes('CPU 飙升') && x.offsetParent);
    if(el){el.click(); return true;} return false;
  });
  await wait(300);
  await clickText(page, '确认注入') || await clickText(page, '开始注入') || await clickText(page, '注入');
  await wait(2200);
  return clicked;
}
async function makeMp4(){
  return new Promise((resolve,reject)=>{
    const args=['-y','-framerate',String(FPS),'-i',`${FRAMES}/frame_%05d.jpg`,'-r',String(FPS),'-vf',`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`,'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',OUT];
    const p=spawn('ffmpeg',args); let err=''; p.stderr.on('data',d=>err+=d); p.on('close',c=>c?reject(new Error(err.slice(-2000))):resolve());
  });
}
(async()=>{
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],defaultViewport:{width:W,height:H,deviceScaleFactor:1}});
  const page=await browser.newPage(); await page.setViewport({width:W,height:H});
  // 0-5s: dashboard
  await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded',timeout:20000}); await page.waitForSelector('#root > *',{timeout:20000}); await wait(2500); await overlay(page,'AIOps · CPU 告警全链路演示'); await caption(page,'从指标异常到自动恢复','本次演示只追踪一个生产级 CPU 告警，完整展示 Observe → Reason → Act → Evaluate。','FULL FLOW / 01'); await hold(page,4.0);
  // 5-11s: inject
  await page.goto('http://127.0.0.1:3000/incidents',{waitUntil:'domcontentloaded',timeout:20000}); await page.waitForSelector('#root > *',{timeout:20000}); await wait(2500); await overlay(page,'AIOps · Fault Injection'); await caption(page,'① 故障注入：order-service CPU 95%','Prometheus 指标超过阈值 80%，以 CRITICAL 级别进入 Incident 状态机。','FAULT INJECTION / 02'); await hold(page,1.2); await selectCpuAndTrigger(page); await caption(page,'告警事件已进入编排器','MonitorAgent 负责异常确认、去重和上下文归一化，生成可追踪的 incident_id。','ORCHESTRATOR / 03'); await hold(page,3.8);
  // 11-19s: click first detail
  await overlay(page,'AIOps · RCA → HEAL');
  const details=await page.$$('button'); let clicked=false; for(const el of details){const t=await el.evaluate(e=>e.innerText.trim());if(t==='详情'){await el.click();clicked=true;break;}}
  await wait(1300); await caption(page,'② RCA：证据驱动的根因分析','RCAAgent 汇总指标、历史记忆与拓扑影响链，输出根因候选、置信度和可解释证据。','ROOT CAUSE ANALYSIS / 04'); await hold(page,3.2);
  await page.evaluate(()=>window.scrollTo({top:330,behavior:'smooth'})); await wait(1000); await caption(page,'③ Heal：Playbook + 风险门禁','HealAgent 匹配高 CPU Playbook；ChangeAgent 计算爆炸半径与风险分数，先 Dry-run 再执行。','SELF-HEAL / 05'); await hold(page,3.5);
  // 19-25s evaluation
  await page.goto('http://127.0.0.1:3000/evaluation',{waitUntil:'domcontentloaded',timeout:20000}); await page.waitForSelector('#root > *',{timeout:20000}); await wait(2500); await overlay(page,'AIOps · Evaluation Gate'); await caption(page,'④ 评测：把一次处理变成可度量结果','记录任务成功率、RCA 置信度、MTTR 和自动化率；结果回流 badcase，驱动下一轮优化。','EVALUATION / 06'); await hold(page,4.3);
  // 25-30s agents + final
  await page.goto('http://127.0.0.1:3000/agents',{waitUntil:'domcontentloaded',timeout:20000}); await page.waitForSelector('#root > *',{timeout:20000}); await wait(2500); await overlay(page,'AIOps · Multi-Agent Runtime'); await caption(page,'四类 Agent 协作，而不是单次问答','Monitor → RCA → Heal → Change 通过事件总线和审计日志协作，形成可验证、可回放的闭环。','ARCHITECTURE / 07'); await hold(page,9.9);
  await browser.close(); await makeMp4(); console.log(JSON.stringify({output:OUT,frames:frame,duration_seconds:frame/FPS},null,2));
})().catch(e=>{console.error(e);process.exit(1)});

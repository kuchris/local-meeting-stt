// Real Electron IPC + Qwen inference/termination. Only public fixture audio.
// Set PLAYWRIGHT_MODULE to a local Playwright module if it is not on NODE_PATH.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const data = path.join(root, 'outputs/backend-review/native');
fs.mkdirSync(path.join(data, 'runtime'), { recursive: true });
for (const [name, target] of [['models', 'models'], ['runtime/uv-cache', 'runtime/uv-cache']]) {
  const link = path.join(data, name);
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(root, target), link, 'junction');
}
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({outputDir:path.join(data, 'output')}));
const env = {...process.env, LOCAL_MEETING_STT_ROOT:root, LOCAL_MEETING_STT_DATA_ROOT:data};
delete env.ELECTRON_RUN_AS_NODE;
function processes() {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],
    {encoding:'utf8', windowsHide:true}));
}
function jobPids(parent) {
  const rows = processes();
  const family = new Set([parent]);
  for (let i=0; i<10; i++) for (const p of rows) if (family.has(p.ParentProcessId)) family.add(p.ProcessId);
  return rows.filter(p=>family.has(p.ProcessId) && /^(uv|python|whisper-server)\.exe$/i.test(p.Name)).map(p=>p.ProcessId);
}
async function assertReleased(pids) {
  assert(pids.length > 0, 'No model worker captured');
  const deadline=Date.now()+5000;
  let remaining=pids;
  while (Date.now()<deadline) {
    const current=new Set(processes().map(p=>p.ProcessId));
    remaining=pids.filter(p=>current.has(p));
    if (!remaining.length) return;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.fail(`Workers survived 5s after exit: ${remaining}`);
}
(async()=>{
  const app = await _electron.launch({executablePath:path.join(root,'electron_app/node_modules/electron/dist/electron.exe'),
    args:['--headless',path.join(__dirname,'electron_bootstrap.cjs')],cwd:root,env,timeout:30000});
  let closed = false;
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(()=>{window.backendEvents=[];window.meetingApi.onProcessEvent(e=>window.backendEvents.push(e));});
    const audio = path.join(root,'outputs/asr_benchmark/data/10020345318418093976.wav');
    async function launch(kind) {
      return page.evaluate(async ({kind,audio,outputDir})=>{
        window.backendEvents=[];
        return window.meetingApi.runCommand(kind,{audioPath:audio,outputDir,qwenTokens:256,qwenBatch:1,chunkSeconds:3});
      }, {kind,audio,outputDir:path.join(data,'output')});
    }
    await launch('qwen-gpu');
    await page.waitForFunction(()=>window.backendEvents.some(e=>e.type==='exit'), undefined, {timeout:120000});
    const first = await page.evaluate(()=>window.backendEvents);
    fs.writeFileSync(path.join(data,'qwen-events.json'), JSON.stringify(first,null,2));
    assert.equal(first.find(e=>e.type==='exit').code, 0, JSON.stringify(first));
    const transcript=path.join(data,'output','10020345318418093976_qwen_gpu_transcript.txt');
    assert(fs.readFileSync(transcript,'utf8').trim().length>0);
    console.log('PASS Electron Qwen GPU: real inference and transcript file');
    const cpu = await launch('qwen-cpu');
    await page.waitForFunction(()=>window.backendEvents.some(e=>e.text?.includes('Model ready')), undefined, {timeout:120000});
    const cpuPids = jobPids(app.process().pid);
    await page.evaluate(id=>window.meetingApi.stopCommand(id), cpu.processId);
    await page.waitForFunction(()=>window.backendEvents.some(e=>e.type==='exit'));
    await assertReleased(cpuPids);
    console.log('PASS Electron Stop: CPU model worker exited');
    await launch('qwen-gpu');
    await page.waitForFunction(()=>window.backendEvents.some(e=>e.text?.includes('Model ready')), undefined, {timeout:120000});
    const gpuPids = jobPids(app.process().pid);
    const didClose = app.waitForEvent('close', {timeout:30000});
    await page.evaluate(()=>window.meetingApi.windowControl('close')).catch(()=>{});
    await didClose;
    closed = true;
    await assertReleased(gpuPids);
    console.log('PASS Electron window close: GPU model process tree exited');
  } finally { if (!closed) await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});

// Test an extracted release, with no repository/data-root environment overrides.
// Usage: node portable_smoke.cjs "path/to/Local Meeting STT portable" [--qwen]
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const folder = path.resolve(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const env = {...process.env};
for (const key of ['LOCAL_MEETING_STT_ROOT','LOCAL_MEETING_STT_DATA_ROOT',
  'PORTABLE_EXECUTABLE_DIR','PORTABLE_EXECUTABLE_FILE','ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL']) delete env[key];
const qwen = process.argv.includes('--qwen');
if (qwen) {
  // Only use a disposable extracted copy: these links reuse local test assets.
  fs.symlinkSync(path.join(root,'models/Qwen3-ASR-0.6B'),path.join(folder,'models/Qwen3-ASR-0.6B'),'junction');
  fs.symlinkSync(path.join(root,'runtime/uv-cache'),path.join(folder,'runtime/uv-cache'),'junction');
}
(async()=>{
  const app = await _electron.launch({executablePath:path.join(folder,'Local Meeting STT.exe'),
    args:['--headless'],cwd:os.tmpdir(),env,timeout:30000});
  try {
    assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.3.0');
    const page = await app.firstWindow();
    await page.locator('#interface-language:enabled').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    const assets = await page.evaluate(()=>window.meetingApi.checkAssets());
    fs.writeFileSync(path.join(folder,'outputs/portable-assets.json'),JSON.stringify(assets,null,2));
    assert(assets.some(a=>a.exists && a.id==='whisper-cpp-vulkan'),'Bundled Vulkan runtime not found');
    assert.equal(await app.evaluate(({app})=>app.getPath('userData')),path.join(folder,'runtime/electron-user-data'));
    assert.equal(assets.find(a=>a.id==='whisper-cpp-model').exists,false,'Unexpected bundled model');
    for (const locale of ['zh-TW','ja','en']) {
      await page.locator('#interface-language').selectOption(locale);
      await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
      await page.waitForFunction(async locale=>(await window.meetingApi.loadSettings()).ui.locale===locale,locale);
      assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'settings.json'),'utf8')).ui.locale,locale);
    }
    console.log('PASS packaged 0.3.0: unrelated cwd, bundled assets, English default, three languages and local settings');
    if (qwen) {
      await page.evaluate(()=>{window.events=[];window.meetingApi.onProcessEvent(e=>window.events.push(e));});
      await page.evaluate(({audioPath,outputDir})=>window.meetingApi.runCommand('qwen-gpu',
        {audioPath,outputDir,qwenTokens:256,qwenBatch:1,chunkSeconds:60}),{
        audioPath:path.join(root,'outputs/asr_benchmark/data/10020345318418093976.wav'),outputDir:path.join(folder,'outputs')});
      await page.waitForFunction(()=>window.events.some(e=>e.type==='exit'),undefined,{timeout:180000});
      const events=await page.evaluate(()=>window.events);
      fs.writeFileSync(path.join(folder,'outputs/portable-qwen-events.json'),JSON.stringify(events,null,2));
      assert.equal(events.find(e=>e.type==='exit').code,0,JSON.stringify(events));
      assert(fs.readFileSync(path.join(folder,'outputs/10020345318418093976_qwen_gpu_transcript.txt'),'utf8').trim());
      console.log('PASS packaged Qwen CUDA: public audio produced a transcript using local model/cache');
    }
  } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});

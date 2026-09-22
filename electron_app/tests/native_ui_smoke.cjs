// Real settings/preload test; no recognition or audio capture.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const data = path.join(root, 'outputs/ui-review/native-data');
fs.mkdirSync(data, {recursive:true});
fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({live:{mode:'live-cpp-gpu'}}));
const env={...process.env,LOCAL_MEETING_STT_ROOT:root,LOCAL_MEETING_STT_DATA_ROOT:data};
delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
  const app=await _electron.launch({executablePath:path.join(root,'electron_app/node_modules/electron/dist/electron.exe'),
    args:['--headless',path.join(__dirname,'electron_bootstrap.cjs')],cwd:root,env,timeout:30000});
  try {
    const page=await app.firstWindow();
    await page.locator('#interface-language:enabled').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await page.locator('#interface-language').selectOption('en');
    await page.locator('.tabs').getByRole('button',{name:'Recordings & transcripts',exact:true}).click();
    assert.equal(await page.locator('.selected-session').getByLabel('Backend',{exact:true}).inputValue(),'cpp-gpu');
    await page.locator('.selected-session').getByLabel('Recognition model',{exact:true}).selectOption('qwen');
    assert.equal(await page.locator('.selected-session').getByLabel('Backend',{exact:true}).inputValue(),'qwen-gpu');
    await page.locator('#interface-language').selectOption('ja');
    await page.waitForFunction(async()=>{
      const settings=await window.meetingApi.loadSettings();
      return settings.ui.locale==='ja' && settings.post.kind==='qwen-gpu';
    });
    // Verify real file-backed settings survive renderer reload.
    await page.reload();
    await page.locator('.tabs').getByRole('button',{name:'録音と文字起こし',exact:true}).click();
    assert.equal(await page.locator('.selected-session').getByLabel('実行バックエンド',{exact:true}).inputValue(),'qwen-gpu');
    const saved=JSON.parse(fs.readFileSync(path.join(data,'settings.json'),'utf8'));
    assert.equal(saved.ui.locale,'ja');assert.equal(saved.post.kind,'qwen-gpu');
    // Capture native dialog options without opening an interactive OS dialog.
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async options=>{
      globalThis.lastDialogOptions=options;return {canceled:true,filePaths:[]};
    }});
    await page.evaluate(()=>window.meetingApi.pickAudioFile());
    const title=await app.evaluate(()=>globalThis.lastDialogOptions.title);
    assert.equal(title,'音声ファイルを選択');
    await page.screenshot({path:path.join(root,'outputs/ui-review/implemented/native-japanese.png')});
    console.log('PASS native Electron: language/backend persisted to file, reload restored Qwen CUDA/Japanese, localized native dialog title');
  } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});

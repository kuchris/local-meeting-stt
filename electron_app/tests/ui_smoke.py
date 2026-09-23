"""Built renderer regression checks with an explicit mock IPC boundary.

Run after npm run build:
  uv run --no-project --with playwright python electron_app/tests/ui_smoke.py
Does not open audio devices or launch recognition. Screenshots go to outputs/.
"""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs" / "ui-review" / "implemented"
OUT.mkdir(parents=True, exist_ok=True)
ASSET_IDS = ["faster-whisper", "whisper-cpp-model", "whisper-cpp-base-model", "whisper-cpp-turbo-model", "whisper-cpp-cuda",
             "whisper-cpp-cpu", "whisper-cpp-vulkan", "whisper-cpp-vulkan-loopback", "qwen",
             "whisper-cpp-openvino", "whisper-cpp-openvino-model-xml", "whisper-cpp-openvino-model-bin"]
MOCK = "window.assetIds=" + json.dumps(ASSET_IDS) + r""";
window.calls=[];window.pid=0;window.deferLaunch=false;window.stopFails=false;window.missingAssets=[];
window.meetingApi={
 onProcessEvent(cb){window.emitProcess=cb;return ()=>{}},onAssetDownloadEvent(){return ()=>{}},
 async loadSettings(){return JSON.parse(localStorage.getItem('testSettings')||'{}')},
 async saveSettings(s){localStorage.setItem('testSettings',JSON.stringify(s));return {ok:true}},
 async checkAssets(){return window.assetIds.map(id=>({id,label:id,relativePath:id,exists:!window.missingAssets.includes(id)}))},
 async listAudioDevices(){return {defaultSpeaker:'Headphones',defaultMicrophone:'Default mic',loopbacks:[{id:'headphones',name:'Headphones',kind:'loopback'},{id:'monitor',name:'Monitor speakers',kind:'loopback'}],microphones:[{id:'mic-default',name:'Default mic',kind:'mic'},{id:'usb',name:'USB mic',kind:'mic'}]}},
 async listOutputSessions(){return []},
 async runCommand(kind,args){window.calls.push({kind,args});const id=++window.pid;const launch=()=>{window.emitProcess({type:'start',processId:id,label:kind,command:'local command'});return {processId:id,label:kind}};if(window.deferLaunch)return new Promise(resolve=>window.finishLaunch=()=>resolve(launch()));return launch()},
 async stopCommand(id){if(window.stopFails)throw Error('Stop unavailable');window.calls.push({stop:id});return {stopped:true}},
 async pickAudioFile(){window.calls.push({pick:true});return 'C:\\samples\\meeting.wav'},
 getDroppedFilePath(){return 'C:\\samples\\dropped.wav'},
 async pickOutputFolder(){return null},async openPath(p){window.calls.push({open:p});return {ok:true}},
 async startAssetDownload(){return {}},async stopAssetDownload(){return {}},async windowControl(){return {ok:true}}
};
"""


def within_viewport(page, locator):
    box=locator.bounding_box()
    assert box and box['y'] >= 0 and box['y']+box['height'] <= page.viewport_size['height'], box


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass


server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'electron_app/out/renderer')))
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1280,'height':740})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script(MOCK)
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.wait_for_load_state('networkidle')
        expect(page.locator('html')).to_have_attribute('lang','en')
        expect(page.get_by_role('button',name='Start meeting',exact=True)).to_be_enabled()
        page.locator('#interface-language').select_option('zh-TW')
        start=page.get_by_role('button',name='開始會議',exact=True)
        expect(start).to_be_enabled()
        expect(page.get_by_label('辨識模型',exact=True)).to_have_value('small')
        page.get_by_label('系統音源',exact=True).select_option('monitor')
        page.get_by_label('包含麥克風',exact=True).check()
        page.get_by_label('麥克風',exact=True).select_option('usb')
        expect(page.locator('.capture-summary')).to_contain_text('Monitor speakers ＋ USB mic')
        page.reload();page.wait_for_load_state('networkidle')
        expect(page.get_by_label('系統音源',exact=True)).to_have_value('monitor')
        expect(page.get_by_label('包含麥克風',exact=True)).to_be_checked()
        page.screenshot(path=str(OUT/'live-idle.png'))
        # Repeated clicks during asynchronous IPC must launch only one process.
        page.evaluate('window.deferLaunch=true')
        start.click()
        expect(page.get_by_role('status')).to_have_text('正在啟動')
        expect(page.get_by_label('辨識模型',exact=True)).to_be_disabled()
        page.evaluate("document.querySelector('.stop-meeting').click()")
        assert len(page.evaluate('window.calls.filter(c=>c.kind)'))==1
        page.evaluate('window.finishLaunch()')
        expect(page.get_by_role('status')).to_have_text('執行中')
        assert page.evaluate('window.calls[0].args.systemDevice')=='monitor'
        page.evaluate("window.emitProcess({type:'stdout',processId:1,text:'[00:00:03] では、今週の進捗について確認しましょう。\\n'})")
        expect(page.locator('.meeting-transcript')).to_contain_text('今週の進捗')
        page.screenshot(path=str(OUT/'live-running.png'))
        stop=page.get_by_role('button',name='停止目前工作',exact=True)
        for width,height in [(1280,740),(1180,660)]:
            page.set_viewport_size({'width':width,'height':height})
            for tab in ('即時會議','只錄音','錄音與逐字稿','設定與模型'):
                page.locator('.tabs').get_by_role('button',name=tab,exact=True).click()
                within_viewport(page,stop)
        page.locator('.tabs').get_by_role('button',name='即時會議',exact=True).click()
        page.evaluate('window.stopFails=true')
        stop.click()
        expect(page.get_by_role('alert')).to_contain_text('停止失敗')
        expect(stop).to_be_enabled()
        page.evaluate('window.stopFails=false')
        stop.click()
        expect(page.get_by_role('status')).to_have_text('正在停止')
        page.evaluate("window.emitProcess({type:'exit',processId:1,code:1,signal:null})")
        expect(page.get_by_role('status')).to_have_text('已停止')
        # Base selection routes to its existing backend and forbids unsupported input.
        page.get_by_label('辨識模型',exact=True).select_option('base')
        expect(page.get_by_label('系統音源',exact=True)).to_be_disabled()
        expect(page.get_by_label('包含麥克風',exact=True)).not_to_be_checked()
        expect(page.locator('.capture-summary')).to_contain_text('不支援麥克風')
        page.evaluate('window.deferLaunch=false')
        start.click()
        expect(page.get_by_role('status')).to_have_text('執行中')
        call=page.evaluate('window.calls.filter(c=>c.kind).at(-1)')
        assert call['kind']=='live-cpp-stream-loopback-base' and not call['args']['includeMic']
        # A previous process exit must not reset the active job.
        page.evaluate("window.emitProcess({type:'exit',processId:1,code:1,signal:null})")
        expect(page.get_by_role('status')).to_have_text('執行中')
        page.evaluate("window.emitProcess({type:'stderr',processId:2,text:'Model failed to load'});window.emitProcess({type:'exit',processId:2,code:1,signal:null})")
        expect(page.get_by_role('status')).to_have_text('執行失敗')
        expect(page.get_by_role('alert')).to_contain_text('Model failed to load')
        page.screenshot(path=str(OUT/'failure-minimum.png'))
        # Missing model files block launch and link to setup.
        page.get_by_role('button',name='關閉錯誤提示').click()
        page.evaluate("window.missingAssets=['whisper-cpp-base-model']")
        page.locator('.tabs').get_by_role('button',name='設定與模型',exact=True).click()
        page.get_by_role('button',name='重新整理狀態',exact=True).click()
        page.locator('.tabs').get_by_role('button',name='即時會議',exact=True).click()
        expect(start).to_be_disabled()
        expect(page.locator('.asset-notice')).to_contain_text('whisper-cpp-base-model')
        # Opening audio via the advertised keyboard shortcut feeds post-transcription.
        page.keyboard.press('Control+o')
        expect(page.get_by_role('button',name='開始轉錄',exact=True)).to_be_enabled()
        page.get_by_role('button',name='開始轉錄',exact=True).click()
        assert page.evaluate('window.calls.filter(c=>c.kind).at(-1).kind')=='cpp-cpu'
        page.evaluate("window.emitProcess({type:'exit',processId:3,code:0,signal:null})")
        expect(page.get_by_role('status')).to_have_text('已完成')
        page.screenshot(path=str(OUT/'transcribe-minimum.png'))
        # CPU/CUDA preference survives model changes and reloads.
        model=page.locator('.selected-session').get_by_label('辨識模型',exact=True)
        backend=page.locator('.selected-session').get_by_label('執行後端',exact=True)
        backend.select_option('cpp-gpu')
        model.select_option('qwen');expect(backend).to_have_value('qwen-gpu')
        model.select_option('small');expect(backend).to_have_value('cpp-gpu')
        backend.select_option('cpp-cpu')
        model.select_option('qwen');expect(backend).to_have_value('qwen-cpu')
        page.locator('#interface-language').select_option('en')
        page.reload();page.wait_for_load_state('networkidle')
        expect(page.locator('html')).to_have_attribute('lang','en')
        page.locator('.tabs').get_by_role('button',name='Recordings & transcripts',exact=True).click()
        expect(page.locator('.selected-session').get_by_label('Backend',exact=True)).to_have_value('qwen-cpu')
        page.locator('.selected-session').get_by_label('Backend',exact=True).select_option('qwen-gpu')
        page.locator('.selected-session').get_by_label('Recognition model',exact=True).select_option('small')
        expect(page.locator('.selected-session').get_by_label('Backend',exact=True)).to_have_value('cpp-gpu')
        # Switching display language never retranscribes or changes Japanese captions.
        page.locator('.tabs').get_by_role('button',name='Live meeting',exact=True).click()
        page.get_by_role('button',name='Start meeting',exact=True).click()
        page.evaluate("window.emitProcess({type:'stdout',processId:1,text:'[00:00:03] 日本語の字幕はそのまま残ります。\\n'})")
        cases=[('zh-TW',['即時會議','只錄音','錄音與逐字稿','設定與模型'],'停止目前工作','執行中'),
               ('en',['Live meeting','Record audio','Recordings & transcripts','Settings & models'],'Stop current task','Running'),
               ('ja',['リアルタイム会議','録音','録音と文字起こし','設定とモデル'],'現在の処理を停止','実行中')]
        for language,names,stop_name,status in cases:
            page.locator('#interface-language').select_option(language)
            expect(page.locator('html')).to_have_attribute('lang',language)
            expect(page.get_by_role('status')).to_have_text(status)
            for button in page.locator('.window-controls button').all():
                box=button.bounding_box()
                assert box and box['y']>=0 and box['y']+box['height']<=36, box
                assert box['x']+box['width']<=page.viewport_size['width'], box
            for index,name in enumerate(names):
                page.locator('.tabs').get_by_role('button',name=name,exact=True).click()
                within_viewport(page,page.get_by_role('button',name=stop_name,exact=True))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal page overflow'
                if index==0:
                    expect(page.locator('.meeting-transcript')).to_contain_text('日本語の字幕はそのまま残ります。')
                    page.screenshot(path=str(OUT/f'live-{language}.png'))
                if index==2:page.screenshot(path=str(OUT/f'transcribe-{language}.png'))
            assert len(page.evaluate('window.calls.filter(c=>c.kind)'))==1
        page.evaluate('window.stopFails=true')
        page.get_by_role('button',name='現在の処理を停止',exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('停止に失敗')
        page.locator('#interface-language').select_option('en')
        expect(page.get_by_role('alert')).to_contain_text('Stop failed')
        page.evaluate('window.stopFails=false')
        page.get_by_role('button',name='Stop current task',exact=True).click()
        page.evaluate("window.emitProcess({type:'exit',processId:1,code:0,signal:null})")
        expect(page.get_by_role('status')).to_have_text('Stopped')
        # Fresh migration uses an existing CUDA live preference, but saved CPU wins.
        page.evaluate("localStorage.setItem('testSettings',JSON.stringify({live:{mode:'live-cpp-gpu'},post:{kind:'qwen-cpu'},ui:{locale:'ja'}}))")
        page.reload();page.wait_for_load_state('networkidle')
        page.locator('.tabs').get_by_role('button',name='録音と文字起こし',exact=True).click()
        expect(page.locator('.selected-session').get_by_label('実行バックエンド',exact=True)).to_have_value('qwen-cpu')
        page.evaluate("localStorage.setItem('testSettings',JSON.stringify({live:{mode:'live-cpp-gpu'},ui:{locale:'zh-TW'}}))")
        page.reload();page.wait_for_load_state('networkidle')
        page.locator('.tabs').get_by_role('button',name='錄音與逐字稿',exact=True).click()
        expect(page.locator('.selected-session').get_by_label('執行後端',exact=True)).to_have_value('cpp-gpu')
        page.evaluate("localStorage.setItem('testSettings',JSON.stringify({ui:{locale:'invalid'}}))")
        page.reload();page.wait_for_load_state('networkidle')
        expect(page.locator('html')).to_have_attribute('lang','en')
        page.get_by_label('Recognition model',exact=True).select_option('turbo')
        page.get_by_role('button',name='Details',exact=True).click()
        page.get_by_label('Caption preview interval seconds').fill('1.5')
        page.get_by_role('button',name='Start meeting',exact=True).click()
        call=page.evaluate('window.calls.filter(c=>c.kind).at(-1)')
        assert call['kind']=='live-cpp-turbo-gpu' and call['args']['previewSeconds']==1.5
        pid=page.evaluate('window.pid')
        page.evaluate("id=>window.emitProcess({type:'stdout',processId:id,text:'@@PARTIAL\\t前の候補\\n'})",pid)
        expect(page.locator('.partial-caption')).to_contain_text('前の候補')
        page.evaluate("id=>window.emitProcess({type:'stdout',processId:id,text:'@@PARTIAL\\t\\n'})",pid)
        expect(page.locator('.partial-caption')).to_have_count(0)
        page.evaluate("id=>window.emitProcess({type:'stdout',processId:id,text:'@@PARTIAL\\t新しい候補\\n@@FINAL\\t確定した字幕。\\n'})",pid)
        expect(page.locator('.meeting-transcript')).to_contain_text('確定した字幕。')
        expect(page.locator('.partial-caption')).to_have_count(0)
        page.evaluate("id=>window.emitProcess({type:'stdout',processId:id,text:'@@FINAL\\t確定した字幕。\\n'})",pid)
        assert page.locator('.meeting-transcript').inner_text().count('確定した字幕。')==2
        page.get_by_role('button',name='Stop current task',exact=True).click()
        page.evaluate("id=>window.emitProcess({type:'exit',processId:id,code:0,signal:null})",pid)
        assert not errors,errors
        print('PASS: existing UI regressions; three languages on every tab, minimum-size layout, live language switching preserves captions/job, localized errors, locale/backend persistence, CPU/CUDA model switching and settings migration')
        browser.close()
finally:
    server.shutdown();server.server_close()

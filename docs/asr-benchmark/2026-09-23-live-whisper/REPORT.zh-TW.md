# Whisper 即時字幕改版重播 — 2026-09-23

這次把 app 的 whisper.cpp CUDA live 路徑由固定 3 秒硬切，改成 Silero VAD 結句、每秒可修訂預覽、句尾重新辨識後定稿。模型仍在會議期間常駐。以下是公開音訊重播，**不是**真實會議或麥克風／WASAPI／Electron 畫面延遲測試。

## 同模型、同音訊比較

Windows RTX 5070 Ti；whisper.cpp v1.8.4 CUDA server；greedy（beam=1、best-of=1）；固定日文；16 kHz 單聲道；增益 1。四段固定的 FLEURS ja_jp 朗讀音訊，共 218 個正規化參考字元。兩種流程在同一個已載入模型的 server 上依次執行。

| 模型 | 3 秒硬切 CER ↓ | VAD 結句定稿 CER ↓ | 預覽／定稿次數 |
| --- | ---: | ---: | ---: |
| Whisper small | 41.74% | 16.97% | 33／4 |
| Whisper large-v3-turbo | 33.49% | **4.59%** | 33／4 |

Turbo 的 live 路徑按音訊播放速度回放時，首次非空字幕中位時間 **2.657 秒**，音訊塊到對應字幕輸出的 p95 **0.294 秒**，最大排隊 **0.011 秒**，推論請求 p95 **0.285 秒**。首次字幕時間包含音檔開頭靜音；這些不是逐字延遲，也不包含實際音訊裝置及 Electron 繪製時間。small 的比較採虛擬音訊到達時間，不能拿它的延遲與 Turbo 的按播放速度結果直接比較。

先前啟動器固定 2 倍增益。相同 Turbo 音訊以 2 倍增益重播，VAD 定稿 CER 為 5.50%；原音訊約 0.65% 的樣本會在加倍後削波。因此新啟動器使用 1 倍預設增益。這是四段樣本的觀察，不保證所有收音裝置都以 1 倍最準。

## 實作與限制

- 收音持續寫入完整 WAV；辨識端保留當前句子的音訊。Silero VAD 以 500 ms 靜音判定結句、200 ms 邊界留白，預覽預設每 1 秒更新；最長句子為 20 秒，避免無限增長。
- 前一次推論仍在跑時，已到達的音訊全數交給 VAD；過期預覽可略過，已完成的句子仍要定稿。停止時處理尾句並關閉 WAV／server。
- 每段檔案的既知終點只用來停止重播，不用來告訴 VAD 何時結句。四段各產生一次定稿。真人插話、重疊、噪音、低音量、長會議及麥克風與系統音混合仍需實測。
- CER 使用 NFKC、轉小寫、移除空白／標點／控制字元，累加總編輯距離除以總參考字元。這是很小的乾淨朗讀子集，不能當作日文會議的通用準確率。

## 重現

先依 [benchmark 說明](../../../benchmarks/README.md)準備已固定版本的 FLEURS 音檔，並在 Settings & models 下載 Turbo 模型；下載器核對 `ggml-large-v3-turbo.bin` 的 SHA-256：`1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`。

```powershell
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with faster-whisper python benchmarks/replay_live_cpp.py --model turbo --count 4 --gain 1 --realtime
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with faster-whisper python benchmarks/replay_live_cpp.py --model small --count 4 --gain 1
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with psutil --with faster-whisper python test/backend_replay.py --turbo
```

原始逐段字幕和時間：[Turbo 按播放速度](turbo-paced.json)、[small 虛擬到達](small-virtual.json)、[Turbo 2 倍增益](turbo-gain2-virtual.json)。第三個檔案與前兩個是分開的程序執行。音訊來源：[FLEURS](https://huggingface.co/datasets/google/fleurs)；模型來源：[whisper.cpp ggml large-v3-turbo](https://huggingface.co/ggerganov/whisper.cpp/tree/98aa99a0a9db05ae2342309f5096248665f7cba3)。

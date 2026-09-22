# 日文 ASR 本機測試 — 2026-09-22

**建議：低延遲字幕先用 faster-whisper large-v3-turbo，保留整句上下文；Qwen 1.7B 作會後精修候選。**
這是小樣本篩選結果，並非真實會議的最終模型排名。此變更加入測試工具和證據，尚未改動 Electron 的預設辨識模式。

## 測試環境與方法

- GPU：NVIDIA GeForce RTX 5070 Ti（16 GB）；Windows；PyTorch 2.11.0+cu128。
- Whisper：faster-whisper 1.2.1 / CTranslate2 4.8.2、CUDA FP16、beam=1、VAD 開啟。
- Qwen：原生 Transformers 5.16.1、CUDA BF16、SDPA、greedy、無 torch.compile；不是 vLLM 原生串流。
- 所有模型常駐記憶體，batch=1，強制日文；模型下載與載入時間不計入暖機後推論時間。
- FLEURS ja_jp test：固定 revision，依 archive 順序取前 12 個不重複句子 ID；共 136.02 秒、558 個正規化參考字元。
- 每個模型用同一段 3 秒音訊暖機一次，再處理同樣的 12 段音訊；逐一開獨立程序，不同模型不並行爭用 GPU。
- CER：總編輯距離 / 總參考字元；NFKC、轉小寫、移除空白／標點／控制字元；不把漢字數字和阿拉伯數字視為相同。
- 低延遲比較只取相同的前 4 段。每 3 秒硬切、沒有重疊或前文。以實測同步推論耗時模擬音訊到達與單一 worker 排隊。
- 完整句子結果反映保留上下文時的辨識能力；硬切結果反映切句損失，兩者樣本數不同，不直接當作同一測試集比較。

## 完整句子辨識（12 段）

| 模型 | CER ↓ | 處理 136.02 秒音訊 | RTF ↓ | GPU 總用量峰值* |
|---|---:|---:|---:|---:|
| whisper-small | 12.54% | 2.06 s | 0.0151 | 2932 MiB |
| whisper-turbo | 5.02% | 2.00 s | 0.0147 | 4386 MiB |
| qwen-0.6b | 7.89% | 9.10 s | 0.0669 | 4190 MiB |
| qwen-1.7b | 3.76% | 8.94 s | 0.0657 | 6533 MiB |

*每 0.5 秒抽樣的整張 GPU 使用量，包含桌面與其他程式，不是模型專屬 VRAM。RTF < 1 表示推論比音訊播放速度快。

## 每 3 秒硬切的字幕（前 4 段）

| 模型 | CER ↓ | 每段推論 p95 | 第一段非空字幕中位時間 | 最大排隊時間 |
|---|---:|---:|---:|---:|
| whisper-small | 30.73% | 0.092 s | 3.056 s | 0.000 s |
| whisper-turbo | 34.86% | 0.117 s | 3.098 s | 0.000 s |
| qwen-0.6b | 25.23% | 0.378 s | 3.138 s | 0.000 s |
| qwen-1.7b | 26.15% | 0.474 s | 3.168 s | 0.000 s |

## 保留上下文，每秒更新一次字幕（實際按播放速度回放）

使用同一個 Turbo 模型、相同前 4 段音訊。音訊按牆鐘逐秒到達，每次只辨識已到達的前綴；新預覽取代舊預覽，不直接串接。

- 共產生 52 次字幕更新；第一段非空字幕中位時間 **3.115 秒**。
- 音訊更新到字幕輸出的 p95 延遲：**0.201 秒**；最大排隊時間 0.001 秒。
- 最終字幕 CER：**4.59%**；同一 4 段完整句子基準為 4.59%，硬切為 34.86%。
- 前綴邊界使用資料集已知的句子邊界；只對最終字幕評分，尚未評估預覽反覆改字。不能宣稱已完成 production VAD 或穩定字幕提交機制。
- 字幕時間從每個 WAV 起點計算，包括開頭靜音；沒有逐字時間標註，不能將這些數字稱為逐字延遲。

## 靜音與首次啟動

三秒全零靜音的輸出：

- whisper-small：（空白）
- whisper-turbo：（空白）
- qwen-0.6b：ええ。
- qwen-1.7b：はい。

Whisper 開啟 VAD，Qwen 未接外部 VAD，因此靜音結果是目前測試管線差異，不能單憑此斷言模型架構優劣。
首次推論／載入時間保存在 JSON。它們受快取與第一次初始化影響，測試順序固定，不能直接用來作冷啟動排名；正式應用應在顯示 Ready 前完成暖機。

## 實作方向

1. 即時字幕以 CUDA Turbo 作候選；保留句內上下文，用可修訂預覽降低等待時間。
2. 加入 VAD 結句、最長視窗及穩定文字提交規則，避免每 3 秒硬切。
3. 用帶噪音、多人、專有名詞的真實日文會議錄音做下一輪驗證，再決定是否改預設模式。
4. Qwen 1.7B 作會後精修候選；這次沒有實作或驗證 Qwen/vLLM 原生串流、torch.compile、麥克風或 WASAPI。

## 重現與證據

執行方式見 [benchmarks/README.md](../../../benchmarks/README.md)。環境用 uv.lock 固定；模型 revision、原始逐段字幕、時序與錯誤數見同目錄 JSON。
音訊及模型留在 Git 忽略的 outputs/、models/；此報告只包含公開資料集的逐字稿與測試結果。

資料來源：[Google FLEURS](https://huggingface.co/datasets/google/fleurs)，CC-BY-4.0。樣本 ID、SHA-256 與固定 revision 見 [data-manifest.json](data-manifest.json)。

模型來源：

- [whisper-small](https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120)：`536b0662742c02347bc0e980a01041f333bce120`
- [whisper-turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo/tree/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf)：`0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`
- [qwen-0.6b](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf/tree/7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c)：`7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c`
- [qwen-1.7b](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf/tree/bcd2b5b7f32b480ab5790554cfa8347f246a14f3)：`bcd2b5b7f32b480ab5790554cfa8347f246a14f3`

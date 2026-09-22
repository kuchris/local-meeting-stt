# Nemotron 3.5 ASR 0.6B 本機實測 — 2026-09-22

使用同一批日文音訊，實測原生串流及完整句子。這是模型篩選，不是 Electron 功能上線。

## 環境與方法

- NVIDIA GeForce RTX 5070 Ti；Windows；PyTorch 2.11.0+cu128；Transformers 5.16.1。
- 實際載入 637,997,088 個參數；模型名稱為 0.6B。CUDA FP32、greedy、batch=1、固定 ja-JP，無 compile、無外部 VAD。
- 模型與處理器只讀本機檔案；HF_HUB_OFFLINE=1。沒有上傳音訊。兩個設定分別用獨立程序，依次使用 GPU。
- FLEURS ja_jp 固定 12 段、136.02 秒、558 字元；同一正規化方式重新計算 CER。低延遲回放使用相同前 4 段。
- 整句與串流分別暖機；首次啟動另存 JSON，不計入暖機後速度。
- 串流只為已到達 PCM 計算特徵，模型跨塊保存 encoder/decoder cache。最後不足一塊補零送出；不丟掉尾音。
- 音訊採實際牆鐘節奏到達，並記錄每次文字變化、分塊處理、排隊及完成時間。

## 160 ms 的實際支援差異

官方 model card 列有 160 ms，但本次固定 revision 的 processor 和 encoder 設定只有 lookahead [3, 0, 6, 13]，對應 320、80、560、1120 ms。
實際呼叫 set_num_lookahead_tokens(1) 會拋出 ValueError；沒有覆寫 checkpoint 限制。此次改測 320 ms 與 80 ms。
這只代表本次 Transformers checkpoint 的可用設定，不表示所有 NeMo/runtime 都不支援 160 ms。

## 完整句子（12 段）

Nemotron 的整句 forward 仍使用指定 chunk attention 設定，不代表無限向後看的離線模式。

| 模型／設定 | CER ↓ | 處理 136.02 秒音訊 | RTF ↓ |
|---|---:|---:|---:|
| Turbo FP16（既有基準） | 5.02% | 1.997 s | 0.0147 |
| Nemotron 320 ms FP32 | 12.37% | 1.857 s | 0.0137 |
| Nemotron 80 ms FP32 | 13.98% | 1.979 s | 0.0145 |

## 按播放速度回放（相同前 4 段）

| 模型／設定 | 最終 CER ↓ | 首次非空字幕中位時間 | 分塊完成延遲 p95 | 最大排隊 |
|---|---:|---:|---:|---:|
| Turbo 每 1 秒重辨識前綴 | 4.59% | 3.115 s | 0.201 s | 0.001 s |
| Nemotron 原生 320 ms | 16.06% | 2.678 s | 0.032 s | 0.010 s |
| Nemotron 原生 80 ms | 17.43% | 2.635 s | 0.028 s | 0.023 s |

首次字幕從 WAV 起點計時，包含開頭靜音。分塊完成延遲從該塊最後所需音訊到達後計算，不含等待收集該塊的時間，不能稱為逐字延遲或端到端字幕延遲。
Turbo 可修訂前綴，Nemotron 使用原生 cache；更新節奏不同，數字比較的是各自可部署管線，不是同架構控制實驗。Turbo 基準是同日較早的測量，未同步重跑。

## 記憶體及靜音

- 320 ms：PyTorch peak allocated 2588 MiB；整張 GPU 抽樣峰值 4586 MiB（包含桌面與其他程式）；3 秒靜音：空白。
- 80 ms：PyTorch peak allocated 2588 MiB；整張 GPU 抽樣峰值 4646 MiB（包含桌面與其他程式）；3 秒靜音：空白。

## 結果解讀與限制

本次小樣本建議暫時保留 Turbo：Nemotron 首字較早、分塊處理較短，但日文字元錯誤較多；沒有把 Electron 預設切換成 Nemotron。

先對照上表的 CER 與首字時間選擇，不以 chunk 設定代替實際字幕延遲。這份 pilot 不能證明任何模型在所有日文會議較好。
樣本是乾淨朗讀，沒有多人重疊、會議術語或真實麥克風噪音。檔案終點由資料集提供，不是已驗證的 VAD；尚未接入 WASAPI/Electron，也未測長會議 cache 成長。
推論後保存原始字幕和時序；報告產生器核對資料集、模型 revision、樣本 ID、CER、尾塊與音訊到達時間。CPU 測試另驗證各塊特徵與整段特徵一致，以及未到達音訊不能改變當前特徵。

## 重現與來源

執行方式見 [benchmarks/README.md](../../../benchmarks/README.md)。原始結果、checkpoint 設定與 checksum 均在本目錄。

- [NVIDIA 模型及官方使用說明](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/tree/ea30d66debe3740a08b573244286791d423d6b3e)，revision `ea30d66debe3740a08b573244286791d423d6b3e`。
- [FLEURS](https://huggingface.co/datasets/google/fleurs)，CC-BY-4.0，固定樣本與 SHA-256 見 data-manifest.json。
- [先前四模型基準](../2026-09-22/REPORT.zh-TW.md)。

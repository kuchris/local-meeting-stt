<p align="center">
  <img src="docs/icon.png" width="96" alt="Local Meeting STT 圖示">
</p>

<h1 align="center">Local Meeting STT</h1>

<p align="center">
  <a href="https://github.com/kuchris/local-meeting-stt/releases/latest"><img src="https://img.shields.io/github/v/release/kuchris/local-meeting-stt" alt="Release"></a>
  <a href="https://github.com/kuchris/local-meeting-stt/stargazers"><img src="https://img.shields.io/github/stars/kuchris/local-meeting-stt" alt="Stars"></a>
  <a href="https://github.com/kuchris/local-meeting-stt/forks"><img src="https://img.shields.io/github/forks/kuchris/local-meeting-stt" alt="Forks"></a>
  <a href="https://github.com/kuchris/local-meeting-stt/issues"><img src="https://img.shields.io/github/issues/kuchris/local-meeting-stt" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kuchris/local-meeting-stt" alt="License"></a>
</p>

[English](README.md) · **中文** · [日本語](README-JA.md)

在 Windows 上執行的本機會議字幕、錄音及會後轉錄工具。透過喇叭／耳機的系統音訊回送（loopback），擷取 Teams、瀏覽器會議或其他桌面音訊，亦可混入麥克風。錄音與語音辨識均在你的電腦上處理。

**介面預設為英文。** 可在 Settings（設定）切換繁體中文或日文，程式會記住你的選擇。介面語言與辨識語言互相獨立；辨識語言可選中文（普通話）、粵語、英文、日文，或逐句自動偵測。

![英文會議介面](docs/meeting-ui.png)

*畫面中的字幕為測試文字，並非真實會議錄音。*

## 開始使用

應用程式以 Rust（[Tauri 2](https://tauri.app/)）包裝 Python 及 whisper.cpp 後端，視窗使用系統內建的 WebView2，不另外打包瀏覽器引擎。從原始碼執行需要：

- Windows 10／11 及 WebView2 執行環境（Windows 11 已內建）。
- [Rust](https://rustup.rs/)（MSVC 工具鏈）及 [uv](https://docs.astral.sh/uv/)。
- 所選後端需要的本機模型與執行環境。
- CUDA 需要 NVIDIA GPU；其他後端各有硬體要求。

```powershell
cd desktop\src-tauri
cargo run
```

1. 開啟 **Settings（設定）**，檢查並下載所需檔案。
2. 在 **Live（即時會議）** 選擇模型、後端及系統音訊來源。
3. 如需收錄自己的聲音，開啟 **Include microphone** 並選擇麥克風。
4. 按下 **Start meeting** 開始；同一個按鈕可停止工作。標題列會在所有頁面顯示工作狀態及經過時間。

全新設定預設在 CPU 上執行 SenseVoice-Small。支援 NVIDIA CUDA 的電腦可選擇它的 CUDA 後端或 Whisper large-v3-turbo；兩者都要先在 Settings & models 下載。

首次設定可能需要下載相依套件及模型。安裝後，辨識使用本機模型，不會呼叫雲端 ASR 服務。程序正在執行不代表已收到音訊，請查看字幕及程序日誌確認。

亦可下載 [portable 版本](https://github.com/kuchris/local-meeting-stt/releases)。v0.3.0 及之前發佈的安裝包是舊版 Electron 應用程式。根目錄的 `open_desktop_app.cmd` 會優先開啟已建置的 release 版本，否則會建置並執行目前 checkout 的程式碼。

舊版 Electron + React 介面保留在 [`electron` 分支](https://github.com/kuchris/local-meeting-stt/tree/electron)，兩者使用相同的後端及 `settings.json`。

## 功能頁面

| 頁面 | 功能 |
| --- | --- |
| Live | 大型即時字幕，旁邊是模型、後端、音訊及 WAV 設定。 |
| Record | 錄音供稍後轉錄，可設定錄音時限。 |
| Recordings | 選擇錄音，或把音訊檔案拖放到視窗任何位置，再選擇模型與後端；錄音已有的逐字稿可一鍵開啟。 |
| Settings | 外觀、語言及輸出資料夾；檢查／下載模型及執行檔。 |

即時字幕可選 **Whisper large-v3-turbo**（CUDA）或 **SenseVoice-Small**（CPU 或 CUDA）。會後轉錄可選 **Whisper small**、**Whisper large-v3-turbo**（CUDA，與即時字幕同一模型）、**SenseVoice-Small**（CPU 或 CUDA，與即時字幕同一模型）、**Qwen3-ASR 0.6B**，或較準確但需另外下載的 **Qwen3-ASR 1.7B**。沒有 NVIDIA 顯示卡時，SenseVoice 是最快的選擇。以每種語言 12 段固定音訊合併成約 2 分鐘的檔案轉錄（RTX 5070 Ti；日文、普通話、粵語為錯字率，英文為錯詞率）：Whisper small 為 15.6%／14.7%／失敗／17.0%，每檔 2.5–14 秒；Whisper large-v3-turbo 為 12.5%／7.8%／9.2%／16.7%，3–4 秒；SenseVoice-Small（CPU）為 9.1%／6.6%／4.2%／12.5%，3–4 秒；Qwen3-ASR 0.6B 為 14.9%／6.4%／4.7%／21.6%，12–31 秒；Qwen3-ASR 1.7B 為 8.6%／11.4%／3.5%／9.1%，13–17 秒。Whisper small 對粵語檔案只輸出標點及重複字母。Qwen3-ASR 1.7B 的普通話錯誤大多是把年份寫成中文數字（2011 寫成二零一一），而參考文本用阿拉伯數字。

錄音檔頁面的**會議詞彙**（使用 Qwen 時）會把會議的人名及術語交給 Qwen 作為上下文。以同一批檔案、每個檔案含 5 個人名測試：不填詞彙時 Qwen 1.7B 認出粵語 2 個、普通話 3 個人名（錯字率 3.5%／11.4%）；填入這 5 個人名後為 3 個、5 個（3.2%／10.7%）；再加 8 個無關詞亦無插入任何無關詞。Qwen 0.6B 配上較長而混雜的詞彙表時普通話錯字率由 6.4% 升至 8.3%，所以詞彙表宜只放該會議的名稱。Whisper 用同樣名稱作提示沒有多認出任何名稱，反而令 Turbo 普通話錯字率上升，因此 Whisper 不使用詞彙。Qwen 目前用於檔案轉錄，不支援即時字幕。

**辨識語言**（自動偵測、中文、粵語、英文、日文）在即時會議及錄音檔頁面選擇。中文及粵語的即時字幕和檔案轉錄預設以繁體（香港）輸出，亦可在 Settings 的**中文字體**改為簡體；SenseVoice 及 whisper.cpp 本身大多輸出簡體。日文會議、含日文假名的字幕，以及 SenseVoice 判斷為日文的字幕保持原樣。Vulkan 檔案轉錄目前仍只辨識日文。

以 RTX 5070 Ti、每種語言 12 段固定 FLEURS 音訊經即時流程重播：SenseVoice-Small 在普通話（錯字率 6.6% 對 8.8%）及粵語（3.0% 對 6.2–7.7%）較準，Whisper large-v3-turbo 在日文（5.4% 對 7.7–8.6%）及英文（錯詞率 4.2% 對 7.6–8.0%）較準。這是乾淨朗讀而非會議，而且 FLEURS 粵語是以粵語朗讀書面語，並非口語粵語。

程式會儲存會後轉錄的後端選擇。在 Whisper 與 Qwen 之間切換時，會保留 CPU／CUDA 偏好。若未儲存轉錄偏好，轉錄會預選即時字幕的模型：Turbo 用 Whisper large-v3-turbo，SenseVoice 用相同後端的 SenseVoice-Small（全新設定為 SenseVoice CPU）。明確儲存的 CPU 選擇不會被覆蓋。

## 後端與本機檔案

| 後端 | 本機檔案 | 備註 |
| --- | --- | --- |
| SenseVoice-Small CPU | `models/SenseVoiceSmall/` | 預設的即時字幕，經 sherpa-onnx 以 CPU 執行（int8，約 230 MB）；WAV 可選。 |
| SenseVoice-Small CUDA | `models/SenseVoiceSmall-fp32/` | 可選，以 NVIDIA GPU 執行的即時字幕（fp32，約 900 MB）。第一次執行會下載 NVIDIA 的 CUDA 12／cuDNN 9 套件（約 1.5 GB）。 |
| whisper.cpp CPU | `whisper_cpp/bin_cpu/Release/` + `ggml-small.bin` | 檔案轉錄。 |
| whisper.cpp CUDA | `whisper_cpp/bin_cuda/Release/` + `ggml-small.bin` | NVIDIA GPU，檔案轉錄。 |
| whisper.cpp CUDA Turbo | `whisper_cpp/bin_cuda/Release/` + `ggml-large-v3-turbo.bin` | 可選的 NVIDIA 即時字幕及檔案轉錄；下載器會固定版本並核對 SHA-256。 |
| whisper.cpp Vulkan | `whisper_cpp/bin_vulkan/Release/` + `ggml-small.bin` | 檔案轉錄。 |
| OpenVINO NPU/GPU | `whisper_cpp/bin_openvino/Release/` + small 模型及 encoder XML/BIN | 需要相容的 OpenVINO 裝置及本機建置。 |
| Qwen CPU/CUDA | `models/Qwen3-ASR-0.6B/` | 檔案轉錄，共用固定版本的 Python 執行環境。 |
| Qwen 1.7B CPU/CUDA | `models/Qwen3-ASR-1.7B/` | 可選，約 4.4 GB，在 Settings 的對應行下載；辨識較準，需要更多 GPU 記憶體。與 Qwen 0.6B 共用執行環境。 |

`ggml-*.bin` 應放在 `whisper_cpp/models/`。Turbo 即時字幕同時需要 `whisper-server.exe` 及 `whisper-cli.exe`。檔案檢查只確認路徑存在，不會驗證硬體相容性或所有下載檔案的完整性。Vulkan 與 OpenVINO 執行檔來自本機建置或發佈包，並非一般模型下載的一部分。

## 延遲與停止行為

即時會議期間會一直載入同一個模型（Turbo 使用 whisper.cpp 伺服器）。Silero VAD 偵測句子邊界；以 0.1 秒為單位收音，未完句子每 0.3 秒（SenseVoice）或 0.5 秒（Turbo）重新辨識一次，並作為逐字稿最後一行逐字顯示；辨識結果修訂時會原地改字。偵測到停頓後再辨識整句並定稿，取代該行；超過 8 秒的句子亦會在最近一次 250 毫秒的停頓處先定稿（最長 20 秒）。以 40 秒連續粵語經應用程式重播（SenseVoice CPU），字幕每 0.1–0.2 秒更新一次，而非每秒一次；即時流程的更新延遲 p95 為 0.13 秒，六個 CPU 核心滿載時為 0.35 秒。預覽要先聽到 0.6 秒（SenseVoice）或 0.8 秒（Turbo）語音，而且要符合所選語言的文字系統：以每種語言 4 段音訊重播，與最終字幕不符的預覽在 Turbo 由 8.3% 降至 0.9%，SenseVoice 由 2.3% 降至 0.8%。推論忙碌時仍保留到達的音訊，可略過過期預覽，但會繼續處理已完成的句子及保存 WAV。會議結束時會釋放模型。收音使用 0.5 秒 WASAPI 緩衝（soundcard 預設約 10 毫秒，收音執行緒稍有延遲就會丟失音訊），並把各段音訊當作一個連續訊號重新取樣，因此 WAV 沒有缺口或接縫。

Python 即時辨識／錄音工作最多有 10 秒停止擷取、關閉 WAV 並釋放模型程序。若未能退出，應用程式會終止整個程序樹。檔案轉錄工作採用強制終止。關閉應用程式時亦會等待清理。停止可能捨棄排隊中或未完整的字幕，亦可能中斷尚未完成的輸出；最終逐字稿請使用已儲存的錄音重新轉錄。

Qwen 啟動器共用 `python_backend/qwen-requirements.txt`，包含 PyTorch 2.11／CUDA 12.8，支援 RTX 5070 Ti 等相容的 NVIDIA GPU。CPU 選項使用相同執行環境，但在 CPU 上推論。載入模型權重前會測試 GPU 運算核心；缺少本機模型時會顯示明確錯誤。

詳見[後端診斷與實測](docs/backend-review.md)。公開音訊重播、舊版 Electron 的原生檢查，以及本版的檔案轉錄、停止及執行中關閉視窗檢查均已通過，但不能據此保證真實會議的辨識準確度或音訊擷取可靠性。

新版 Whisper 即時字幕的同模型比較及限制見[公開音訊重播報告](docs/asr-benchmark/2026-09-23-live-whisper/REPORT.zh-TW.md)。

## 儲存檔案與操作

預設輸出到 `outputs/`。一般即時會議資料夾如下：

```text
outputs/
  live_meeting_YYYYMMDD_HHMMSS/
    audio.wav
    live_transcript.txt
```

資料夾前綴因後端而異。轉錄會議資料夾內的 `audio.wav` 時，逐字稿會寫回同一資料夾；其他匯入音訊的逐字稿則寫入設定的輸出資料夾。

- **Ctrl+O**：選擇要轉錄的音訊。
- **Ctrl+1** 至 **Ctrl+4**：切換頁面。
- **Ctrl+L**：顯示／隱藏程序日誌（亦可按標題列的日誌按鈕）。
- **Esc**：關閉程序日誌。

`settings.json` 儲存介面語言（`ui.locale`）、主題（`ui.theme`）、會後轉錄後端（`post.kind`）、擷取裝置、即時模式及輸出偏好。沿用設定檔升級時會保留語言選擇；語言設定缺失或無效時使用英文。原始後端日誌、裝置名稱、檔名及逐字稿內容不會翻譯。

## 建置與驗證

```powershell
cd desktop\src-tauri
cargo test
cargo clippy --all-targets
```

字幕一致性測試、音訊裝置檢查及原始碼結構請參閱 [desktop 開發與測試說明](desktop/README.md)。

在專案根目錄執行 `build_portable_folder.cmd` 可建立資料夾式 portable 版本。每次建置會建立新的 `desktop/dist/release-VERSION-ID/`，包含 portable 資料夾、帶版本號的 ZIP 及 `SHA256SUMS.txt`。套件包含執行檔、後端腳本、全新英文設定，以及本機可用的 Vulkan／OpenVINO 執行檔；不包含模型、Python 環境、快取或錄音。CPU／CUDA 執行檔可在 Settings 下載。

從 [Releases](https://github.com/kuchris/local-meeting-stt/releases/latest) 下載後，將完整 ZIP 解壓到可寫入的資料夾，再執行 `Local Meeting STT.exe`；後端資料夾必須與執行檔放在一起。請先安裝 [uv](https://docs.astral.sh/uv/getting-started/installation/) 並加入 PATH。視窗需要 WebView2 執行環境，Windows 11 已內建。首次使用需要網路下載 Python 相依套件及模型。升級時請解壓到另一個資料夾，再按需要複製模型及錄音。Windows 版本未經程式碼簽署。

命令列流程及後端目錄結構請參閱 [TECHNICAL.md](TECHNICAL.md)。

## ASR 實驗

獨立的[基準測試工具](benchmarks/README.md)用於比較日文辨識準確度及延遲，不會變更應用程式的模型選擇：

- [Whisper／Qwen 實測結果](docs/asr-benchmark/2026-09-22/REPORT.zh-TW.md)。
- [Nemotron 3.5 串流辨識後續測試](docs/asr-benchmark/2026-09-22-nemotron/REPORT.zh-TW.md)。

這些是小規模、乾淨語音的實驗，不代表真實會議品質保證。模型、下載的音訊、私人錄音、快取及執行環境均排除於 Git 之外。

## 授權

Apache-2.0。詳見 [LICENSE](LICENSE)。

## 支持專案

如果這個專案對你有幫助，歡迎在 GitHub 按 Star，讓更多人找到它。

[![Star 歷史圖](https://api.star-history.com/svg?repos=kuchris/local-meeting-stt&type=Date)](https://www.star-history.com/#kuchris/local-meeting-stt&Date)

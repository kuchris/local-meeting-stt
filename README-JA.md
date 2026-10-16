<p align="center">
  <img src="docs/icon.png" width="96" alt="Local Meeting STT アイコン">
</p>

<h1 align="center">Local Meeting STT</h1>

<p align="center">
  <a href="https://github.com/kuchris/local-meeting-stt/releases/latest"><img src="https://img.shields.io/github/v/release/kuchris/local-meeting-stt" alt="Release"></a>
  <a href="https://github.com/kuchris/local-meeting-stt/stargazers"><img src="https://img.shields.io/github/stars/kuchris/local-meeting-stt" alt="Stars"></a>
  <a href="https://github.com/kuchris/local-meeting-stt/forks"><img src="https://img.shields.io/github/forks/kuchris/local-meeting-stt" alt="Forks"></a>
  <a href="https://github.com/kuchris/local-meeting-stt/issues"><img src="https://img.shields.io/github/issues/kuchris/local-meeting-stt" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kuchris/local-meeting-stt" alt="License"></a>
</p>

[English](README.md) · [中文](README-ZH.md) · **日本語**

会議のリアルタイム字幕、録音、会議後の文字起こしをローカルで行う Windows デスクトップアプリです。スピーカー／ヘッドセットのループバック音声から Teams、ブラウザー会議などのデスクトップ音声を取得し、必要に応じてマイク音声も混ぜられます。録音と音声認識は自分のパソコン上で処理します。

**初期表示言語は英語です。** Settings（設定）で繁体字中国語または日本語に切り替えられ、選択は保存されます。表示言語と認識言語は別です。認識言語は中国語（標準語）、広東語、英語、日本語から選ぶか、文ごとに自動検出できます。

![英語の会議画面](docs/meeting-ui.png)

*画面の字幕はテスト用の文章です。実際の会議録音ではありません。*

## はじめに

アプリは Python と whisper.cpp のバックエンドを Rust（[Tauri 2](https://tauri.app/)）で包んだもので、ウィンドウはシステムの WebView2 を使い、ブラウザーエンジンを同梱しません。ソースコードから実行する場合の要件：

- Windows 10／11 と WebView2 ランタイム（Windows 11 には標準搭載）。
- [Rust](https://rustup.rs/)（MSVC ツールチェーン）と [uv](https://docs.astral.sh/uv/)。
- 選択したバックエンドに必要なローカルモデルと実行環境。
- CUDA を使う場合は NVIDIA GPU。ほかのバックエンドにもそれぞれハードウェア要件があります。

```powershell
cd desktop\src-tauri
cargo run
```

1. **Settings（設定）** で必要なファイルを確認・ダウンロードします。
2. **Live（ライブ）** でモデル、バックエンド、システム音声の入力元を選びます。
3. 自分の声も収録する場合は **Include microphone** をオンにし、マイクを選びます。
4. **Start meeting** で開始し、同じボタンで停止します。タイトルバーにはどのページでも処理の状態と経過時間が表示されます。

新規設定では SenseVoice-Small を CPU で実行します。対応する NVIDIA GPU がある場合は、その CUDA バックエンドか Whisper large-v3-turbo を選べます。どちらも先に Settings & models でダウンロードしてください。

初回設定時には依存パッケージやモデルをダウンロードする場合があります。導入後はクラウド ASR サービスではなくローカルモデルで認識します。プロセスが動いていても音声を取得できているとは限らないため、字幕とログを確認してください。

[ポータブル版](https://github.com/kuchris/local-meeting-stt/releases)も利用できます。v0.3.0 までの公開パッケージは以前の Electron 版です。ルートの `open_desktop_app.cmd` はビルド済みのリリース版があればそちらを開き、なければ現在の checkout をビルドして起動します。

以前の Electron + React 版は [`electron` ブランチ](https://github.com/kuchris/local-meeting-stt/tree/electron)に残しています。どちらも同じバックエンドと `settings.json` を使います。

## 画面構成

| ページ | 機能 |
| --- | --- |
| Live | 大きなリアルタイム字幕と、その横にモデル、バックエンド、音声、WAV の設定。 |
| Record | 後で文字起こしする音声を録音。録音時間の上限も設定可能。 |
| Recordings | 録音を選択するか、音声ファイルをウィンドウのどこにでもドロップして、モデルとバックエンドを指定。既存の文字起こしはワンクリックで開けます。 |
| Settings | 外観、言語、出力先。モデルとランタイムの確認・ダウンロード。 |

リアルタイム字幕では **Whisper large-v3-turbo**（CUDA）と **SenseVoice-Small**（CPU または CUDA）、会議後の文字起こしでは **Whisper small**、**Whisper large-v3-turbo**（CUDA、ライブ字幕と同じモデル）、**Qwen3-ASR 0.6B**、追加ダウンロードでより高精度な **Qwen3-ASR 1.7B** を選べます。各言語 12 クリップを約 2 分の 1 ファイルにまとめた文字起こし（RTX 5070 Ti。日本語・中国語・広東語は文字誤り率、英語は単語誤り率）：Whisper small は 15.6%／14.7%／失敗／17.0%、1 ファイル 2.5〜14 秒。Whisper large-v3-turbo は 12.5%／7.8%／9.2%／16.7%、3〜4 秒。Qwen3-ASR 0.6B は 14.9%／6.4%／4.7%／21.6%、12〜31 秒。Qwen3-ASR 1.7B は 8.6%／11.4%／3.5%／9.1%、13〜17 秒。Whisper small は広東語ファイルで句読点と同じ文字の繰り返ししか出しませんでした。Qwen3-ASR 1.7B の中国語の誤りの多くは、年を漢数字で書いたもの（2011 を二零一一）で、参照テキストは算用数字です。Qwen は現在、ファイルの文字起こし専用で、リアルタイム字幕には使用しません。

**認識言語**（自動検出、中国語、広東語、英語、日本語）はライブと録音一覧のページで選びます。中国語と広東語のライブ字幕は繁体字（香港）で表示します。Settings の**中国語の字体**で簡体字にも変更できます（SenseVoice 自体は簡体字で出力します）。日本語の会議、仮名を含む字幕、SenseVoice が日本語と判定した字幕はそのままです。Vulkan のファイル文字起こしは現在も日本語のみです。

RTX 5070 Ti で各言語 12 件の固定 FLEURS 音声をライブ処理で再生した結果、中国語（CER 6.6% 対 8.8%）と広東語（3.0% 対 6.2–7.7%）では SenseVoice-Small、日本語（5.4% 対 7.7–8.6%）と英語（WER 4.2% 対 7.6–8.0%）では Whisper large-v3-turbo がより正確でした。会議ではなくきれいな朗読音声で、FLEURS の広東語は口語ではなく書き言葉の朗読です。

文字起こしのバックエンド選択は保存されます。Whisper と Qwen を切り替えても CPU／CUDA の選択を引き継ぎます。文字起こしの設定がまだない場合、ライブ設定が CUDA なら文字起こしも CUDA（ライブのモデルが Whisper large-v3-turbo ならそれを使用）、それ以外は CPU が初期選択になります。明示的に保存した CPU 設定は維持されます。

## バックエンドとローカルファイル

| バックエンド | ローカルファイル | 備考 |
| --- | --- | --- |
| SenseVoice-Small CPU | `models/SenseVoiceSmall/` | 初期設定のリアルタイム字幕。sherpa-onnx により CPU で実行（int8、約 230 MB）。WAV は任意。 |
| SenseVoice-Small CUDA | `models/SenseVoiceSmall-fp32/` | 任意。NVIDIA GPU のリアルタイム字幕（fp32、約 900 MB）。初回実行時に NVIDIA の CUDA 12／cuDNN 9 パッケージ（約 1.5 GB）をダウンロードします。 |
| whisper.cpp CPU | `whisper_cpp/bin_cpu/Release/` + `ggml-small.bin` | ファイルの文字起こし。 |
| whisper.cpp CUDA | `whisper_cpp/bin_cuda/Release/` + `ggml-small.bin` | NVIDIA GPU。ファイルの文字起こし。 |
| whisper.cpp CUDA Turbo | `whisper_cpp/bin_cuda/Release/` + `ggml-large-v3-turbo.bin` | 追加の NVIDIA ライブ字幕とファイルの文字起こし。ダウンロード時にバージョンと SHA-256 を確認。 |
| whisper.cpp Vulkan | `whisper_cpp/bin_vulkan/Release/` + `ggml-small.bin` | ファイルの文字起こし。 |
| OpenVINO NPU/GPU | `whisper_cpp/bin_openvino/Release/` + small モデルと encoder XML/BIN | 対応する OpenVINO デバイスとローカルビルドが必要。 |
| Qwen CPU/CUDA | `models/Qwen3-ASR-0.6B/` | ファイルの文字起こし。バージョンを固定した Python 実行環境を共用。 |
| Qwen 1.7B CPU/CUDA | `models/Qwen3-ASR-1.7B/` | 任意・約 4.4 GB。Settings の該当行からダウンロード。精度が高い分、GPU メモリを多く使います。Qwen 0.6B と同じ実行環境を使います。 |

`ggml-*.bin` は `whisper_cpp/models/` に配置します。Turbo のライブ字幕には `whisper-cli.exe` に加えて `whisper-server.exe` が必要です。ファイルチェックはパスの存在を確認するもので、ハードウェア互換性や全ダウンロードファイルの完全性までは検証しません。Vulkan と OpenVINO の実行ファイルはローカルビルドまたはリリースに含まれるもので、通常のモデルダウンロードとは別です。

## 遅延と停止時の動作

ライブ会議中は同じモデルを読み込んだまま維持します（Turbo は whisper.cpp サーバー）。Silero VAD が発話の区切りを検出します。0.1 秒単位で取り込み、発話中は 0.3 秒（SenseVoice）または 0.5 秒（Turbo）ごとに再認識して、文字起こしの最終行に一文字ずつ表示します。認識結果が修正されると、その場で文字を書き換えます。短い無音の後に発話全体を再認識して確定し、その行を置き換えます。8 秒を超える発話は、直近の 250 ミリ秒の間でも確定します（最長 20 秒）。40 秒の連続した広東語をアプリで再生した測定（SenseVoice CPU）では、字幕は毎秒ではなく 0.1〜0.2 秒ごとに更新され、ライブ処理の更新遅延は p95 0.13 秒、CPU 6 コアが高負荷のときは 0.35 秒でした。プレビューは 0.6 秒（SenseVoice）または 0.8 秒（Turbo）の音声を聞いてから表示し、選んだ言語の文字体系でないものは出しません。各言語 4 クリップの再生では、最終字幕と食い違うプレビューが Turbo で 8.3% から 0.9%、SenseVoice で 2.3% から 0.8% に減りました。推論が遅い場合も到着した音声は保持し、古いプレビューだけを省略できます。完了した発話と WAV 録音は処理を続け、終了時にモデルを解放します。音声取得には 0.5 秒の WASAPI バッファーを使い（soundcard の既定は約 10 ミリ秒で、取得スレッドが少し遅れるだけで音声が欠落していました）、各ブロックを一続きの信号として再サンプリングするため、WAV に欠落や継ぎ目はありません。

Python のライブ認識／録音ジョブには、音声取得の停止、WAV のクローズ、モデルプロセスの解放に最大 10 秒の猶予があります。終了しない場合、アプリがプロセスツリーを終了します。ファイルの文字起こしジョブは強制終了します。アプリを閉じる際も終了処理を待ちます。停止によって待機中・途中の字幕が欠けたり、未完了の出力が中断されたりする場合があります。最終的な文字起こしには保存した録音を使用してください。

Qwen ランチャーは `python_backend/qwen-requirements.txt` を共用します。PyTorch 2.11／CUDA 12.8 を含み、RTX 5070 Ti などの対応 NVIDIA GPU をサポートします。CPU オプションも同じ実行環境を使い、CPU 上で推論します。重みの読み込み前に GPU カーネルを確認し、ローカルモデルがない場合は明確なエラーを表示します。

詳細は[バックエンドの診断と実測](docs/backend-review.md)を参照してください。公開音声のリプレイ、以前の Electron 版のネイティブ確認、本版のファイル文字起こし・停止・実行中に閉じる確認は通過していますが、実際の会議での認識精度や録音の信頼性を保証するものではありません。

新しい Whisper ライブ字幕の同一モデル比較と制限は[公開音声リプレイ報告](docs/asr-benchmark/2026-09-23-live-whisper/REPORT.zh-TW.md)を参照してください。

## 保存ファイルと操作

既定の出力先は `outputs/` です。一般的なライブ会議の構成：

```text
outputs/
  live_meeting_YYYYMMDD_HHMMSS/
    audio.wav
    live_transcript.txt
```

フォルダー名の接頭辞はバックエンドによって異なります。セッション内の `audio.wav` を文字起こしすると、同じフォルダーに結果を保存します。その他の読み込んだ音声は、設定された出力先に結果を保存します。

- **Ctrl+O**：文字起こしする音声を選択。
- **Ctrl+1**〜**Ctrl+4**：ページを切り替え。
- **Ctrl+L**：プロセスログの表示／非表示（タイトルバーのログボタンでも可）。
- **Esc**：プロセスログを閉じる。

`settings.json` に表示言語（`ui.locale`）、テーマ（`ui.theme`）、文字起こしバックエンド（`post.kind`）、音声デバイス、ライブモード、出力設定を保存します。設定ファイルを引き継いで更新すると言語選択も維持されます。言語設定がない場合や無効な場合は英語になります。バックエンドの生ログ、デバイス名、ファイル名、文字起こし本文は翻訳しません。

## ビルドと検証

```powershell
cd desktop\src-tauri
cargo test
cargo clippy --all-targets
```

字幕の一致テスト、音声デバイスの確認、ソース構成については [desktop 開発・テスト手順](desktop/README.md)を参照してください。

リポジトリのルートで `build_portable_folder.cmd` を実行すると、フォルダー形式のポータブル版を作成します。毎回新しい `desktop/dist/release-VERSION-ID/` に、ポータブルフォルダー、バージョン付き ZIP、`SHA256SUMS.txt` を出力します。実行ファイル、バックエンドスクリプト、英語の初期設定、ローカルにある Vulkan／OpenVINO ランタイムを含みます。モデル、Python 環境、キャッシュ、録音は含みません。CPU／CUDA ランタイムは Settings からダウンロードできます。

[Releases](https://github.com/kuchris/local-meeting-stt/releases/latest) からダウンロードし、ZIP 全体を書き込み可能なフォルダーに展開して `Local Meeting STT.exe` を実行してください。バックエンドのフォルダーは実行ファイルと一緒に置いてください。先に [uv](https://docs.astral.sh/uv/getting-started/installation/) をインストールし、PATH に追加する必要があります。ウィンドウには WebView2 ランタイムが必要で、Windows 11 には標準搭載されています。初回は Python の依存パッケージとモデルのダウンロードにインターネット接続が必要です。更新時は別フォルダーに展開し、必要に応じてモデルや録音をコピーしてください。Windows 版はコード署名されていません。

コマンドラインの操作とバックエンドのディレクトリ構成は [TECHNICAL.md](TECHNICAL.md) を参照してください。

## ASR の実験

独立した[ベンチマークツール](benchmarks/README.md)で日本語の認識精度と遅延を比較できます。アプリのモデル選択は変更しません。

- [Whisper／Qwen の実測結果](docs/asr-benchmark/2026-09-22/REPORT.zh-TW.md)。
- [Nemotron 3.5 ストリーミング認識の追加検証](docs/asr-benchmark/2026-09-22-nemotron/REPORT.zh-TW.md)。

少量の明瞭な音声を使った実験であり、会議音声での品質を保証するものではありません。モデル、ダウンロードした音声、個人の録音、キャッシュ、実行環境は Git の対象外です。

## ライセンス

Apache-2.0。[LICENSE](LICENSE) を参照してください。

## 応援する

このプロジェクトが役に立ったら、GitHub の Star で応援していただけると嬉しいです。

[![Star 履歴](https://api.star-history.com/svg?repos=kuchris/local-meeting-stt&type=Date)](https://www.star-history.com/#kuchris/local-meeting-stt&Date)

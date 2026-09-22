<p align="center">
  <img src="docs/icon.png" width="96" alt="Local Meeting STT アイコン">
</p>

<h1 align="center">Local Meeting STT</h1>

[![Release](https://img.shields.io/github/v/release/kuchris/local-meeting-stt)](https://github.com/kuchris/local-meeting-stt/releases/latest)
[![Stars](https://img.shields.io/github/stars/kuchris/local-meeting-stt)](https://github.com/kuchris/local-meeting-stt/stargazers)
[![Forks](https://img.shields.io/github/forks/kuchris/local-meeting-stt)](https://github.com/kuchris/local-meeting-stt/forks)
[![Issues](https://img.shields.io/github/issues/kuchris/local-meeting-stt)](https://github.com/kuchris/local-meeting-stt/issues)
[![License](https://img.shields.io/github/license/kuchris/local-meeting-stt)](LICENSE)

[English](README.md) · [中文](README-ZH.md) · **日本語**

会議のリアルタイム字幕、録音、会議後の文字起こしをローカルで行う Windows デスクトップアプリです。スピーカー／ヘッドセットのループバック音声から Teams、ブラウザー会議などのデスクトップ音声を取得し、必要に応じてマイク音声も混ぜられます。録音と音声認識は自分のパソコン上で処理します。

**初期表示言語は英語です。** タイトルバーで繁体字中国語または日本語に切り替えられ、選択は保存されます。表示言語と認識言語は別です。現在提供している認識処理は日本語を対象としています。

![英語の会議画面](docs/meeting-ui.png)

*画面の字幕はテスト用の文章です。実際の会議録音ではありません。*

## はじめに

ソースコードから実行する場合の要件：

- Windows、Node.js/npm、[uv](https://docs.astral.sh/uv/)。
- 選択したバックエンドに必要なローカルモデルと実行環境。
- CUDA を使う場合は NVIDIA GPU。ほかのバックエンドにもそれぞれハードウェア要件があります。

```powershell
cd electron_app
npm ci
npm run dev
```

1. **Settings & models（設定とモデル）** で必要なファイルを確認・ダウンロードします。
2. **Live meeting（ライブ会議）** でモデルとシステム音声の入力元を選びます。
3. 自分の声も収録する場合は **Include microphone** を有効にし、マイクを選びます。
4. **Details** を開き、バックエンドと音声チャンクの長さを選びます。
5. **Start meeting** で開始します。**Stop current task** はどのページからでも操作できます。

新規設定では、faster-whisper の Whisper small を CPU で実行します。対応する NVIDIA GPU がある場合は、Details で whisper.cpp CUDA を選べます。Whisper base は既存の Vulkan loopback バックエンドで利用できます。

初回設定時には依存パッケージやモデルをダウンロードする場合があります。導入後はクラウド ASR サービスではなくローカルモデルで認識します。プロセスが動いていても音声を取得できているとは限らないため、字幕とログを確認してください。

[ポータブル版](https://github.com/kuchris/local-meeting-stt/releases)も利用できます。公開済みパッケージは最新ソースより古い場合があります。ルートの `open_electron_app.cmd` は既存のパッケージ版があればそちらを開きます。現在の checkout を試す場合は、上記の `npm run dev` を使用してください。

## 画面構成

| ページ | 機能 |
| --- | --- |
| Live meeting | 大きなリアルタイム字幕、モデルと音声の選択、任意の WAV 録音、折りたたみ可能な診断情報。 |
| Record audio | 後で文字起こしする音声を録音。録音時間の上限も設定可能。 |
| Recordings & transcripts | 録音を選択するか音声ファイルをドロップし、モデルとバックエンドを指定。 |
| Settings & models | 必要なファイルの確認・ダウンロードと出力先の設定。 |

リアルタイム字幕では **Whisper small** と **Whisper base**、会議後の文字起こしでは **Whisper small** と **Qwen3-ASR 0.6B** を選べます。Qwen は現在、ファイルの文字起こし専用で、リアルタイム字幕には使用しません。

文字起こしのバックエンド選択は保存されます。Whisper と Qwen を切り替えても CPU／CUDA の選択を引き継ぎます。文字起こしの設定がまだない場合、ライブ設定が CUDA なら文字起こしも CUDA、それ以外は CPU が初期選択になります。明示的に保存した CPU 設定は維持されます。

## バックエンドとローカルファイル

| バックエンド | ローカルファイル | 備考 |
| --- | --- | --- |
| faster-whisper | `models/faster-whisper-small/` | 初期設定は CPU。リアルタイム字幕と任意の WAV 録音。 |
| whisper.cpp CPU | `whisper_cpp/bin_cpu/Release/` + `ggml-small.bin` | ライブサーバーとファイルの文字起こし。 |
| whisper.cpp CUDA | `whisper_cpp/bin_cuda/Release/` + `ggml-small.bin` | NVIDIA GPU。ライブサーバーとファイルの文字起こし。 |
| whisper.cpp Vulkan | `whisper_cpp/bin_vulkan/Release/` + `ggml-small.bin` | 常駐ライブサーバーとファイルの文字起こし。 |
| OpenVINO NPU/GPU | `whisper_cpp/bin_openvino/Release/` + small モデルと encoder XML/BIN | 対応する OpenVINO デバイスとローカルビルドが必要。 |
| Vulkan loopback | `whisper_cpp/bin_vulkan_loopback/Release/` + base または small モデル | システム既定のループバックのみ。個別のデバイス指定やマイク音声のミックスには非対応。 |
| Qwen CPU/CUDA | `models/Qwen3-ASR-0.6B/` | ファイルの文字起こし。バージョンを固定した Python 実行環境を共用。 |

`ggml-*.bin` は `whisper_cpp/models/` に配置します。ライブ CPU／CUDA には `whisper-cli.exe` に加えて `whisper-server.exe` が必要です。ファイルチェックはパスの存在を確認するもので、ハードウェア互換性や全ダウンロードファイルの完全性までは検証しません。Vulkan と OpenVINO の実行ファイルはローカルビルドまたはリリースに含まれるもので、通常のモデルダウンロードとは別です。

## 遅延と停止時の動作

Whisper CPU／CUDA のライブ会議では、モデルを読み込んだサーバーを会議中維持します。音声チャンクごとの再読み込みを避け、セッション終了時にモデルを解放します。

音声チャンクの初期値は 3 秒です。チャンクが揃ってから認識を開始します。更新を速めたい場合は Details で 2 秒を試せますが、文脈が短くなる可能性があります。faster-whisper は待機中のチャンクを 1 つ保持します。推論が追いつかない場合は古い字幕用チャンクを破棄しますが、WAV 録音は継続します。

Python のライブ認識／録音ジョブには、音声取得の停止、WAV のクローズ、モデルプロセスの解放に最大 10 秒の猶予があります。終了しない場合、Electron がプロセスツリーを終了します。ファイルの文字起こしとネイティブの loopback ジョブは強制終了します。アプリを閉じる際も終了処理を待ちます。停止によって待機中・途中の字幕が欠けたり、未完了の出力が中断されたりする場合があります。最終的な文字起こしには保存した録音を使用してください。

Qwen ランチャーは `python_backend/qwen-requirements.txt` を共用します。PyTorch 2.11／CUDA 12.8 を含み、RTX 5070 Ti などの対応 NVIDIA GPU をサポートします。CPU オプションも同じ実行環境を使い、CPU 上で推論します。重みの読み込み前に GPU カーネルを確認し、ローカルモデルがない場合は明確なエラーを表示します。

詳細は[バックエンドの診断と実測](docs/backend-review.md)を参照してください。公開音声のリプレイとネイティブ Electron の確認は通過していますが、実際の会議での認識精度や録音の信頼性を保証するものではありません。

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
- **Ctrl+B**：サイドバーの折りたたみ／展開。
- **View > Clear logs**：字幕を残して診断ログを消去。
- **Details**：バックエンドの出力を確認し、ライブバックエンドとチャンク長を変更。

`settings.json` に表示言語（`ui.locale`）、文字起こしバックエンド（`post.kind`）、音声デバイス、ライブモード、出力設定を保存します。設定ファイルを引き継いで更新すると言語選択も維持されます。言語設定がない場合や無効な場合は英語になります。バックエンドの生ログ、デバイス名、ファイル名、文字起こし本文は翻訳しません。

## ビルドと検証

```powershell
cd electron_app
npm run build
```

レンダラーのテスト、3 言語のレイアウト確認、ネイティブ設定／IPC テスト、バックエンドのライフサイクルとリプレイ確認については、[Electron 開発・テスト手順](electron_app/README.md)を参照してください。

リポジトリのルートで `build_portable_folder.cmd` を実行すると、フォルダー形式のポータブル版を作成します。毎回新しい `electron_app/dist/release-VERSION-ID/` に、ポータブルフォルダー、バージョン付き ZIP、`SHA256SUMS.txt` を出力します。実行ファイル、バックエンドスクリプト、英語の初期設定、ローカルにある Vulkan／OpenVINO ランタイムを含みます。モデル、Python 環境、キャッシュ、録音は含みません。CPU／CUDA ランタイムは Settings & models からダウンロードできます。

[Releases](https://github.com/kuchris/local-meeting-stt/releases/latest) からダウンロードし、ZIP 全体を書き込み可能なフォルダーに展開して `Local Meeting STT.exe` を実行してください。DLL とリソースフォルダーは一緒に置いてください。先に [uv](https://docs.astral.sh/uv/getting-started/installation/) をインストールし、PATH に追加する必要があります。パッケージ版の実行には Node.js/npm は不要です。初回は Python の依存パッケージとモデルのダウンロードにインターネット接続が必要です。更新時は別フォルダーに展開し、必要に応じてモデルや録音をコピーしてください。Windows 版はコード署名されていません。

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

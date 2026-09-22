export const locales = ["zh-TW", "en", "ja"] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const localeNames: Record<Locale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
};
export function isLocale(value: unknown): value is Locale {
  return locales.includes(value as Locale);
}

// Source labels remain stable keys. Product names, paths and backend logs are not translated.
export const messages: Record<string, readonly [string, string, string]> = {
  即時會議: ["即時會議", "Live meeting", "リアルタイム会議"],
  只錄音: ["只錄音", "Record audio", "録音"],
  錄音與逐字稿: [
    "錄音與逐字稿",
    "Recordings & transcripts",
    "録音と文字起こし",
  ],
  設定與模型: ["設定與模型", "Settings & models", "設定とモデル"],
  音訊錄製: ["音訊錄製", "Audio recording", "音声録音"],
  介面語言: ["介面語言", "Interface language", "表示言語"],
  "Select audio file": [
    "選擇音訊檔案",
    "Select audio file",
    "音声ファイルを選択",
  ],
  "Select output folder": [
    "選擇輸出資料夾",
    "Select output folder",
    "出力フォルダーを選択",
  ],
  Audio: ["音訊", "Audio", "音声"],
  "Toggle sidebar  Ctrl+B": [
    "切換側邊欄  Ctrl+B",
    "Toggle sidebar  Ctrl+B",
    "サイドバー切り替え  Ctrl+B",
  ],
  "Toggle sidebar": ["切換側邊欄", "Toggle sidebar", "サイドバー切り替え"],
  "Application menu": ["應用程式選單", "Application menu", "アプリメニュー"],
  File: ["檔案", "File", "ファイル"],
  Run: ["執行", "Run", "実行"],
  View: ["檢視", "View", "表示"],
  Window: ["視窗", "Window", "ウィンドウ"],
  Help: ["說明", "Help", "ヘルプ"],
  "Open Audio...": ["開啟音訊…", "Open audio…", "音声を開く…"],
  "Open Outputs": ["開啟輸出資料夾", "Open outputs", "出力フォルダーを開く"],
  Exit: ["結束", "Exit", "終了"],
  開始所選模型的會議: [
    "開始所選模型的會議",
    "Start with selected model",
    "選択したモデルで開始",
  ],
  停止目前工作: ["停止目前工作", "Stop current task", "現在の処理を停止"],
  "Toggle Sidebar": ["切換側邊欄", "Toggle sidebar", "サイドバー切り替え"],
  "Clear Logs": ["清除日誌", "Clear logs", "ログを消去"],
  Setup: ["設定", "Settings", "設定"],
  Minimize: ["最小化", "Minimize", "最小化"],
  "Maximize / Restore": [
    "最大化／還原",
    "Maximize / restore",
    "最大化／元に戻す",
  ],
  Maximize: ["最大化／還原", "Maximize / restore", "最大化／元に戻す"],
  Close: ["關閉", "Close", "閉じる"],
  "GitHub Repository": [
    "GitHub 儲存庫",
    "GitHub repository",
    "GitHub リポジトリ",
  ],
  "日文會議 · 本機字幕": [
    "日文會議 · 本機字幕",
    "Japanese · Local captions",
    "日本語会議・ローカル字幕",
  ],
  本機辨識: ["本機辨識", "Local recognition", "ローカル音声認識"],
  音訊留在這部電腦: [
    "音訊留在這部電腦",
    "Audio stays on this device",
    "音声はこの端末内で処理",
  ],
  "LOCAL MEETING STT / 日本語": [
    "LOCAL MEETING STT / 日文",
    "LOCAL MEETING STT / Japanese",
    "LOCAL MEETING STT / 日本語",
  ],
  準備就緒: ["準備就緒", "Ready", "準備完了"],
  正在啟動: ["正在啟動", "Starting", "起動中"],
  執行中: ["執行中", "Running", "実行中"],
  正在停止: ["正在停止", "Stopping", "停止中"],
  已停止: ["已停止", "Stopped", "停止済み"],
  已完成: ["已完成", "Completed", "完了"],
  執行失敗: ["執行失敗", "Failed", "処理失敗"],
  "正在啟動…": ["正在啟動…", "Starting…", "起動中…"],
  "正在停止…": ["正在停止…", "Stopping…", "停止中…"],
  開始會議: ["開始會議", "Start meeting", "会議を開始"],
  開始錄音: ["開始錄音", "Start recording", "録音を開始"],
  開始轉錄: ["開始轉錄", "Transcribe", "文字起こしを開始"],
  查看詳細資訊: ["查看詳細資訊", "View details", "詳細を見る"],
  關閉錯誤提示: ["關閉錯誤提示", "Dismiss error", "エラーを閉じる"],
  "目前工作：": ["目前工作：", "Current task: ", "現在の処理："],
  正在準備: ["正在準備", "Preparing", "準備中"],
  "· 啟動程序不代表已收到音訊": [
    "· 啟動程序不代表已收到音訊",
    "· Process started; audio input is not yet confirmed",
    "・プロセス起動済み。音声入力は未確認です",
  ],
  會議設定: ["會議設定", "Meeting settings", "会議設定"],
  辨識模型: ["辨識模型", "Recognition model", "認識モデル"],
  系統音源: ["系統音源", "System audio", "システム音声"],
  系統預設音源: ["系統預設音源", "Default system audio", "既定のシステム音声"],
  "（預設）": ["（預設）", " (default)", "（既定）"],
  裝置未連接: ["裝置未連接", "Device disconnected", "デバイス未接続"],
  包含麥克風: ["包含麥克風", "Include microphone", "マイク音声を含める"],
  麥克風: ["麥克風", "Microphone", "マイク"],
  預設麥克風: ["預設麥克風", "Default microphone", "既定のマイク"],
  "儲存 WAV": ["儲存 WAV", "Save WAV", "WAV を保存"],
  重新整理音訊裝置: [
    "重新整理音訊裝置",
    "Refresh audio devices",
    "音声デバイスを更新",
  ],
  " · 不含麥克風": [" · 不含麥克風", " · No microphone", " ・マイクなし"],
  "此後端只支援系統預設 loopback，不支援麥克風混音。": [
    "此後端只支援系統預設 loopback，不支援麥克風混音。",
    "Default system loopback only; microphone mixing is unavailable.",
    "既定のシステムループバックのみ対応。マイクとのミックスはできません。",
  ],
  " · 此後端會同時錄製 WAV": [
    " · 此後端會同時錄製 WAV",
    " · This backend also records WAV",
    " ・WAV も同時に録音します",
  ],
  "音訊裝置檢查失敗：": [
    "音訊裝置檢查失敗：",
    "Audio device check failed: ",
    "音声デバイスの確認に失敗：",
  ],
  即時字幕: ["即時字幕", "Live captions", "リアルタイム字幕"],
  "／ 日本語": ["／ 日文", "/ Japanese", "／ 日本語"],
  跟隨最新字幕: ["跟隨最新字幕", "Follow latest captions", "最新の字幕に追従"],
  "確認音源後開始會議，字幕會顯示在這裡。": [
    "確認音源後開始會議，字幕會顯示在這裡。",
    "Check your audio source and start a meeting. Captions will appear here.",
    "音声入力を確認して会議を開始すると、ここに字幕が表示されます。",
  ],
  "辨識中 · 文字仍可能修訂": [
    "辨識中 · 文字仍可能修訂",
    "Recognizing · Text may change",
    "認識中・テキストは変更される場合があります",
  ],
  "輸出資料夾：": ["輸出資料夾：", "Output folder: ", "出力フォルダー："],
  開啟逐字稿: ["開啟逐字稿", "Open transcript", "文字起こしを開く"],
  缺少此組合的檔案: [
    "缺少此組合的檔案",
    "Required files are missing",
    "必要なファイルがありません",
  ],
  "正在檢查本機模型…": [
    "正在檢查本機模型…",
    "Checking local models…",
    "ローカルモデルを確認中…",
  ],
  管理模型與後端: [
    "管理模型與後端",
    "Manage models & backends",
    "モデルとバックエンドを管理",
  ],
  音訊錄製程序已啟動: [
    "音訊錄製程序已啟動",
    "Recording process started",
    "録音プロセスを起動しました",
  ],
  "只保留音訊，稍後再轉錄": [
    "只保留音訊，稍後再轉錄",
    "Record now, transcribe later",
    "まず録音し、後から文字起こし",
  ],
  "錄製系統音源，並依設定混入麥克風。": [
    "錄製系統音源，並依設定混入麥克風。",
    "Record system audio, with optional microphone mixing.",
    "システム音声を録音します。設定に応じてマイク音声も含めます。",
  ],
  設定錄音時限: ["設定錄音時限", "Set recording duration", "録音時間を指定"],
  錄音秒數: ["錄音秒數", "Duration (seconds)", "録音時間（秒）"],
  "儲存位置：": ["儲存位置：", "Save to: ", "保存先："],
  "· 使用頂部按鈕停止": [
    "· 使用頂部按鈕停止",
    "· Use the top button to stop",
    "・上部のボタンで停止",
  ],
  錄音列表: ["錄音列表", "Recordings", "録音一覧"],
  "Refresh sessions": ["重新整理錄音", "Refresh recordings", "録音一覧を更新"],
  "此資料夾尚無錄音。": [
    "此資料夾尚無錄音。",
    "No recordings in this folder.",
    "このフォルダーには録音がありません。",
  ],
  拖放音訊檔案: [
    "拖放音訊檔案",
    "Drop an audio file",
    "音声ファイルをドロップ",
  ],
  "Choose external audio": [
    "選取外部音訊",
    "Choose audio file",
    "音声ファイルを選択",
  ],
  "Resize session list": [
    "調整錄音列表寬度",
    "Resize recordings list",
    "録音一覧の幅を変更",
  ],
  所選錄音: ["所選錄音", "Selected recording", "選択した録音"],
  "Open session folder": [
    "開啟錄音資料夾",
    "Open recording folder",
    "録音フォルダーを開く",
  ],
  外部音訊: ["外部音訊", "External audio", "外部音声"],
  "選取錄音或匯入音訊檔案。": [
    "選取錄音或匯入音訊檔案。",
    "Select a recording or import an audio file.",
    "録音を選択するか、音声ファイルを読み込んでください。",
  ],
  "Qwen 轉錄設定": [
    "Qwen 轉錄設定",
    "Qwen transcription settings",
    "Qwen 文字起こし設定",
  ],
  Chunk: ["分段（秒）", "Chunk (seconds)", "分割長（秒）"],
  Tokens: ["Token 上限", "Token limit", "トークン上限"],
  Batch: ["批次大小", "Batch size", "バッチサイズ"],
  執行後端: ["執行後端", "Backend", "実行バックエンド"],
  "開啟逐字稿：": ["開啟逐字稿：", "Open transcript: ", "文字起こしを開く："],
  模型與後端檔案: [
    "模型與後端檔案",
    "Models & backend files",
    "モデルとバックエンドのファイル",
  ],
  "暫停 {name}": ["暫停 {name}", "Pause {name}", "{name} を一時停止"],
  "下載 {name}": ["下載 {name}", "Download {name}", "{name} をダウンロード"],
  "Setup actions": ["設定操作", "Settings actions", "設定操作"],
  "Refresh status": ["重新整理狀態", "Refresh status", "状態を更新"],
  "Download missing assets": [
    "下載缺少的檔案",
    "Download missing files",
    "不足ファイルをダウンロード",
  ],
  "Open outputs": ["開啟輸出資料夾", "Open outputs", "出力フォルダーを開く"],
  輸出資料夾: ["輸出資料夾", "Output folder", "出力フォルダー"],
  "Output folder": ["輸出資料夾", "Output folder", "出力フォルダー"],
  "Output folder actions": [
    "輸出資料夾操作",
    "Output folder actions",
    "出力フォルダーの操作",
  ],
  "Choose output folder": [
    "選擇輸出資料夾",
    "Choose output folder",
    "出力フォルダーを選択",
  ],
  "Open output folder": [
    "開啟輸出資料夾",
    "Open output folder",
    "出力フォルダーを開く",
  ],
  "Reset output folder": [
    "重設輸出資料夾",
    "Reset output folder",
    "出力フォルダーをリセット",
  ],
  工作詳細資訊: ["工作詳細資訊", "Task details", "処理の詳細"],
  收起詳細資訊: ["收起詳細資訊", "Hide details", "詳細を閉じる"],
  詳細資訊: ["詳細資訊", "Details", "詳細"],
  "音訊分段（秒）": [
    "音訊分段（秒）",
    "Audio chunk (seconds)",
    "音声分割長（秒）",
  ],
  音訊分段秒數: ["音訊分段秒數", "Audio chunk seconds", "音声分割の秒数"],
  "Loopback 使用後端內建的 VAD 分段。": [
    "Loopback 使用後端內建的 VAD 分段。",
    "Loopback uses the backend's built-in VAD segmentation.",
    "ループバックはバックエンド内蔵の VAD で音声を分割します。",
  ],
  "每段收集完成後才辨識；想更快更新可試 2 秒，短分段可能影響句子完整度。停止會釋放模型。":
    [
      "每段收集完成後才辨識；想更快更新可試 2 秒，短分段可能影響句子完整度。停止會釋放模型。",
      "Recognition starts after each chunk. Try 2 seconds for faster updates; shorter chunks may lose sentence context. Stopping releases the model.",
      "各区間の収録後に認識します。2 秒にすると更新が速くなりますが、文脈が失われる場合があります。停止時にモデルを解放します。",
    ],
  "Process log": ["程序日誌", "Process log", "プロセスログ"],
  "清除 log": ["清除日誌", "Clear log", "ログを消去"],
  "尚無程序訊息。": [
    "尚無程序訊息。",
    "No process messages yet.",
    "プロセスメッセージはまだありません。",
  ],
  "whisper.cpp · CUDA（會議期間常駐）": [
    "whisper.cpp · CUDA（會議期間常駐）",
    "whisper.cpp · CUDA (resident)",
    "whisper.cpp · CUDA（会議中は常駐）",
  ],
  "whisper.cpp · CPU（會議期間常駐）": [
    "whisper.cpp · CPU（會議期間常駐）",
    "whisper.cpp · CPU (resident)",
    "whisper.cpp · CPU（会議中は常駐）",
  ],
  Starting: ["正在開始", "Starting", "開始中"],
  Done: ["完成", "Done", "完了"],
  Paused: ["已暫停", "Paused", "一時停止中"],
  "Build locally; not available from the asset downloader.": [
    "須在本機編譯，下載工具未提供。",
    "Build locally; not available from the asset downloader.",
    "ローカルでビルドしてください。ダウンロード機能では提供されません。",
  ],
  "Separate local build; requires the OpenVINO encoder model.": [
    "須另行在本機編譯，並準備 OpenVINO 編碼器模型。",
    "Separate local build; requires the OpenVINO encoder model.",
    "別途ローカルビルドと OpenVINO エンコーダーモデルが必要です。",
  ],
  "Generated locally from the small model for OpenVINO.": [
    "由 small 模型在本機產生，供 OpenVINO 使用。",
    "Generated locally from the small model for OpenVINO.",
    "small モデルからローカルで生成する OpenVINO 用ファイルです。",
  ],
  "Custom local build; see whisper_cpp/vulkan-loopback-custom-build.md.": [
    "自訂本機版本；參閱 whisper_cpp/vulkan-loopback-custom-build.md。",
    "Custom local build; see whisper_cpp/vulkan-loopback-custom-build.md.",
    "独自のローカルビルドです。whisper_cpp/vulkan-loopback-custom-build.md を参照してください。",
  ],
  "無法讀取拖放檔案，請使用選取音訊。": [
    "無法讀取拖放檔案，請使用選取音訊。",
    "Could not read the dropped file. Use the audio file picker.",
    "ドロップしたファイルを読み取れません。ファイル選択を使用してください。",
  ],
  "無法確認工作狀態，請查看詳細資訊。": [
    "無法確認工作狀態，請查看詳細資訊。",
    "Could not confirm task status. Check Details.",
    "処理の状態を確認できません。詳細を確認してください。",
  ],
  "已有工作執行中，請先停止目前工作。": [
    "已有工作執行中，請先停止目前工作。",
    "A task is already running. Stop it first.",
    "別の処理が実行中です。先に停止してください。",
  ],
  "設定未能儲存：": [
    "設定未能儲存：",
    "Could not save settings: ",
    "設定を保存できません：",
  ],
  "無法載入設定：": [
    "無法載入設定：",
    "Could not load settings: ",
    "設定を読み込めません：",
  ],
  "無法檢查本機模型：": [
    "無法檢查本機模型：",
    "Could not check local models: ",
    "ローカルモデルを確認できません：",
  ],
  "無法讀取錄音列表：": [
    "無法讀取錄音列表：",
    "Could not list recordings: ",
    "録音一覧を読み込めません：",
  ],
  "停止失敗：": ["停止失敗：", "Stop failed: ", "停止に失敗："],
  "工作未完成（exit {code}）。請查看詳細資訊。": [
    "工作未完成（exit {code}）。請查看詳細資訊。",
    "Task failed (exit {code}). Check Details.",
    "処理に失敗しました（終了コード {code}）。詳細を確認してください。",
  ],
};

export function translate(
  locale: Locale,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const text = messages[key]?.[locales.indexOf(locale)] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
}

export function translateError(locale: Locale, text: string): string {
  const failed = text.match(/^工作未完成（exit (.+)）。請查看詳細資訊。$/);
  if (failed)
    return translate(locale, "工作未完成（exit {code}）。請查看詳細資訊。", {
      code: failed[1],
    });
  // Keep raw backend errors intact; localize only the application's own wrapper.
  for (const key of Object.keys(messages)) {
    if (key.endsWith("：") && text.startsWith(key))
      return translate(locale, key) + text.slice(key.length);
  }
  return translate(locale, text);
}

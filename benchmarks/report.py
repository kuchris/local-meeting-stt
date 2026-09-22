"""Publish a compact, auditable Markdown report from completed local results."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from prepare import DATA, MODELS, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, default=DATA.parent / "results")
    parser.add_argument("--prefix", type=Path, default=DATA.parent / "prefix_replay.json")
    parser.add_argument("--output", type=Path, default=ROOT / "docs" / "asr-benchmark" / "2026-09-22")
    args = parser.parse_args()
    models = [json.loads((args.results / f"{key}.json").read_text(encoding="utf-8")) for key in MODELS]
    prefix = json.loads(args.prefix.read_text(encoding="utf-8"))
    if any(item["status"] != "complete" for item in [*models, prefix]):
        raise ValueError("Refusing to publish incomplete benchmark results")
    if len({item["manifest_sha256"] for item in [*models, prefix]}) != 1:
        raise ValueError("Results do not share the same audio manifest")
    if any(item["model"] != key for key, item in zip(MODELS, models)):
        raise ValueError("Result filenames and model identities do not match")
    if prefix["model"] != "whisper-turbo":
        raise ValueError("This report template expects a Turbo prefix experiment")
    if len({json.dumps(item["protocol"], sort_keys=True) for item in models}) != 1:
        raise ValueError("Results use different benchmark protocols")
    audio_seconds = models[0]["summary"]["utterance_audio_seconds"]
    reference_chars = sum(item["reference_chars"] for item in models[0]["utterances"])
    utterance_count = len(models[0]["utterances"])
    replay_count = len(models[0]["replays"])
    args.output.mkdir(parents=True, exist_ok=True)
    for key in MODELS:
        shutil.copyfile(args.results / f"{key}.json", args.output / f"{key}.json")
    shutil.copyfile(args.prefix, args.output / "prefix-replay.json")
    shutil.copyfile(DATA / "manifest.json", args.output / "data-manifest.json")
    hashes = {}
    for path in [*args.output.glob("*.json"), *Path(__file__).parent.glob("*.py"), Path(__file__).parent / "uv.lock"]:
        hashes[str(path.relative_to(ROOT)).replace("\\", "/")] = hashlib.sha256(path.read_bytes()).hexdigest()
    (args.output / "checksums.json").write_text(json.dumps(hashes, indent=2), encoding="utf-8")

    lines = [
        "# 日文 ASR 本機測試 — 2026-09-22", "",
        "**建議：低延遲字幕先用 faster-whisper large-v3-turbo，保留整句上下文；Qwen 1.7B 作會後精修候選。**",
        "這是小樣本篩選結果，並非真實會議的最終模型排名。此變更加入測試工具和證據，尚未改動 Electron 的預設辨識模式。", "",
        "## 測試環境與方法", "",
        f"- GPU：{models[0]['gpu']}（16 GB）；Windows；PyTorch {models[0]['packages']['torch']}。",
        "- Whisper：faster-whisper 1.2.1 / CTranslate2 4.8.2、CUDA FP16、beam=1、VAD 開啟。",
        "- Qwen：原生 Transformers 5.16.1、CUDA BF16、SDPA、greedy、無 torch.compile；不是 vLLM 原生串流。",
        "- 所有模型常駐記憶體，batch=1，強制日文；模型下載與載入時間不計入暖機後推論時間。",
        f"- FLEURS ja_jp test：固定 revision，依 archive 順序取前 {utterance_count} 個不重複句子 ID；共 {audio_seconds:.2f} 秒、{reference_chars} 個正規化參考字元。",
        f"- 每個模型用同一段 3 秒音訊暖機一次，再處理同樣的 {utterance_count} 段音訊；逐一開獨立程序，不同模型不並行爭用 GPU。",
        "- CER：總編輯距離 / 總參考字元；NFKC、轉小寫、移除空白／標點／控制字元；不把漢字數字和阿拉伯數字視為相同。",
        "- 低延遲比較只取相同的前 4 段。每 3 秒硬切、沒有重疊或前文。以實測同步推論耗時模擬音訊到達與單一 worker 排隊。",
        "- 完整句子結果反映保留上下文時的辨識能力；硬切結果反映切句損失，兩者樣本數不同，不直接當作同一測試集比較。", "",
        f"## 完整句子辨識（{utterance_count} 段）", "",
        f"| 模型 | CER ↓ | 處理 {audio_seconds:.2f} 秒音訊 | RTF ↓ | GPU 總用量峰值* |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in models:
        summary = item["summary"]
        memory = item["device_memory_mib"]["sampled_peak"]
        lines.append(f"| {item['model']} | {summary['utterance_cer']:.2%} | {summary['utterance_inference_seconds']:.2f} s | {summary['utterance_rtf']:.4f} | {memory} MiB |")
    lines.extend([
        "", "*每 0.5 秒抽樣的整張 GPU 使用量，包含桌面與其他程式，不是模型專屬 VRAM。RTF < 1 表示推論比音訊播放速度快。", "",
        f"## 每 3 秒硬切的字幕（前 {replay_count} 段）", "",
        "| 模型 | CER ↓ | 每段推論 p95 | 第一段非空字幕中位時間 | 最大排隊時間 |",
        "|---|---:|---:|---:|---:|",
    ])
    for item in models:
        summary = item["summary"]
        lines.append(f"| {item['model']} | {summary['chunked_cer']:.2%} | {summary['chunk_inference_p95_seconds']:.3f} s | {summary['first_caption_p50_seconds']:.3f} s | {summary['max_queue_seconds']:.3f} s |")
    summary = prefix["summary"]
    selected_ids = {item["id"] for item in prefix["samples"]}
    turbo = next(item for item in models if item["model"] == "whisper-turbo")
    utterances = [item for item in turbo["utterances"] if item["id"] in selected_ids]
    subset_cer = sum(item["errors"] for item in utterances) / sum(item["reference_chars"] for item in utterances)
    lines.extend([
        "", "## 保留上下文，每秒更新一次字幕（實際按播放速度回放）", "",
        "使用同一個 Turbo 模型、相同前 4 段音訊。音訊按牆鐘逐秒到達，每次只辨識已到達的前綴；新預覽取代舊預覽，不直接串接。", "",
        f"- 共產生 {summary['updates']} 次字幕更新；第一段非空字幕中位時間 **{summary['first_caption_p50_seconds']:.3f} 秒**。",
        f"- 音訊更新到字幕輸出的 p95 延遲：**{summary['update_lag_p95_seconds']:.3f} 秒**；最大排隊時間 {summary['max_queue_seconds']:.3f} 秒。",
        f"- 最終字幕 CER：**{summary['final_cer']:.2%}**；同一 4 段完整句子基準為 {subset_cer:.2%}，硬切為 {turbo['summary']['chunked_cer']:.2%}。",
        "- 前綴邊界使用資料集已知的句子邊界；只對最終字幕評分，尚未評估預覽反覆改字。不能宣稱已完成 production VAD 或穩定字幕提交機制。",
        "- 字幕時間從每個 WAV 起點計算，包括開頭靜音；沒有逐字時間標註，不能將這些數字稱為逐字延遲。", "",
        "## 靜音與首次啟動", "",
        "三秒全零靜音的輸出：", "",
    ])
    for item in models:
        text = item["silence_3s"]["text"] or "（空白）"
        lines.append(f"- {item['model']}：{text}")
    lines.extend([
        "", "Whisper 開啟 VAD，Qwen 未接外部 VAD，因此靜音結果是目前測試管線差異，不能單憑此斷言模型架構優劣。",
        "首次推論／載入時間保存在 JSON。它們受快取與第一次初始化影響，測試順序固定，不能直接用來作冷啟動排名；正式應用應在顯示 Ready 前完成暖機。", "",
        "## 實作方向", "",
        "1. 即時字幕以 CUDA Turbo 作候選；保留句內上下文，用可修訂預覽降低等待時間。",
        "2. 加入 VAD 結句、最長視窗及穩定文字提交規則，避免每 3 秒硬切。",
        "3. 用帶噪音、多人、專有名詞的真實日文會議錄音做下一輪驗證，再決定是否改預設模式。",
        "4. Qwen 1.7B 作會後精修候選；這次沒有實作或驗證 Qwen/vLLM 原生串流、torch.compile、麥克風或 WASAPI。", "",
        "## 重現與證據", "",
        "執行方式見 [benchmarks/README.md](../../../benchmarks/README.md)。環境用 uv.lock 固定；模型 revision、原始逐段字幕、時序與錯誤數見同目錄 JSON。",
        "音訊及模型留在 Git 忽略的 outputs/、models/；此報告只包含公開資料集的逐字稿與測試結果。", "",
        "資料來源：[Google FLEURS](https://huggingface.co/datasets/google/fleurs)，CC-BY-4.0。樣本 ID、SHA-256 與固定 revision 見 [data-manifest.json](data-manifest.json)。", "",
        "模型來源：",
    ])
    lines.append("")
    for key, (repo, revision) in MODELS.items():
        lines.append(f"- [{key}](https://huggingface.co/{repo}/tree/{revision})：`{revision}`")
    (args.output / "REPORT.zh-TW.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.output / "REPORT.zh-TW.md")


if __name__ == "__main__":
    main()

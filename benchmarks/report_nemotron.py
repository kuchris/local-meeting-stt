"""Validate and publish the Nemotron pilot alongside the existing Turbo baseline."""
import hashlib
import json
from pathlib import Path
import shutil

from metrics import score
from prepare import DATA, ROOT
from prepare_nemotron import MODEL_DIR, MODEL_ID, REVISION


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_rows(rows, samples, text_key="text"):
    if [r["id"] for r in rows] != [s["id"] for s in samples]:
        raise ValueError("Sample order/IDs differ")
    for row, sample in zip(rows, samples):
        if row["reference"] != sample["reference"]:
            raise ValueError("Reference differs from manifest")
        calculated = score(sample["reference"], row[text_key])
        for key in ("errors", "reference_chars", "cer"):
            if row[key] != calculated[key]:
                raise ValueError(f"Invalid metric: {key}")


def main():
    source = DATA.parent / "nemotron"
    destination = ROOT / "docs" / "asr-benchmark" / "2026-09-22-nemotron"
    baseline = ROOT / "docs" / "asr-benchmark" / "2026-09-22"
    manifest = read(DATA / "manifest.json")
    manifest_hash = hashlib.sha256((DATA / "manifest.json").read_bytes()).hexdigest()
    models = [read(source / f"{ms}ms-float32.json") for ms in (320, 80)]
    turbo, prefix = read(baseline / "whisper-turbo.json"), read(baseline / "prefix-replay.json")
    for result in [*models, turbo, prefix]:
        if result["status"] != "complete" or result["manifest_sha256"] != manifest_hash:
            raise ValueError("Incomplete result or different dataset")
    for result, ms in zip(models, (320, 80)):
        if result["model"] != MODEL_ID or result["revision"] != REVISION:
            raise ValueError("Unexpected model revision")
        if result["protocol"]["chunk_ms"] != ms or result["protocol"]["dtype"] != "float32":
            raise ValueError("Unexpected streaming protocol")
        verify_rows(result["utterances"], manifest["samples"])
        verify_rows(result["replays"], manifest["samples"][:4])
        for row in result["replays"]:
            if row["chunks"][-1]["audio_end"] != row["audio_seconds"]:
                raise ValueError("Dropped audio tail")
            if row["chunks"][-1]["frame"] + row["chunks"][-1]["frames"] < int(row["audio_seconds"] * 100):
                raise ValueError("Missing mel frames")
            for update in row["updates"]:
                if update["emitted_at"] < update["audio_available"]:
                    raise ValueError("Caption uses future audio")
        for key, rows in (("utterance_cer", result["utterances"]), ("streaming_cer", result["replays"])):
            value = sum(r["errors"] for r in rows) / sum(r["reference_chars"] for r in rows)
            if result["summary"][key] != value:
                raise ValueError("Summary CER differs from rows")
    verify_rows(turbo["utterances"], manifest["samples"])
    verify_rows(prefix["samples"], manifest["samples"][:4], "final_text")
    destination.mkdir(parents=True, exist_ok=True)
    for ms in (320, 80):
        shutil.copyfile(source / f"{ms}ms-float32.json", destination / f"{ms}ms-float32.json")
    shutil.copyfile(DATA / "manifest.json", destination / "data-manifest.json")
    for name in ("config.json", "processor_config.json", "generation_config.json"):
        shutil.copyfile(MODEL_DIR / name, destination / f"model-{name}")
    lines = [
        "# Nemotron 3.5 ASR 0.6B 本機實測 — 2026-09-22", "",
        "使用同一批日文音訊，實測原生串流及完整句子。這是模型篩選，不是 Electron 功能上線。", "",
        "## 環境與方法", "",
        f"- {models[0]['gpu']}；Windows；PyTorch {models[0]['packages']['torch']}；Transformers {models[0]['packages']['transformers']}。",
        f"- 實際載入 {models[0]['parameters']:,} 個參數；模型名稱為 0.6B。CUDA FP32、greedy、batch=1、固定 ja-JP，無 compile、無外部 VAD。",
        "- 模型與處理器只讀本機檔案；HF_HUB_OFFLINE=1。沒有上傳音訊。兩個設定分別用獨立程序，依次使用 GPU。",
        "- FLEURS ja_jp 固定 12 段、136.02 秒、558 字元；同一正規化方式重新計算 CER。低延遲回放使用相同前 4 段。",
        "- 整句與串流分別暖機；首次啟動另存 JSON，不計入暖機後速度。",
        "- 串流只為已到達 PCM 計算特徵，模型跨塊保存 encoder/decoder cache。最後不足一塊補零送出；不丟掉尾音。",
        "- 音訊採實際牆鐘節奏到達，並記錄每次文字變化、分塊處理、排隊及完成時間。", "",
        "## 160 ms 的實際支援差異", "",
        "官方 model card 列有 160 ms，但本次固定 revision 的 processor 和 encoder 設定只有 lookahead [3, 0, 6, 13]，對應 320、80、560、1120 ms。",
        "實際呼叫 set_num_lookahead_tokens(1) 會拋出 ValueError；沒有覆寫 checkpoint 限制。此次改測 320 ms 與 80 ms。",
        "這只代表本次 Transformers checkpoint 的可用設定，不表示所有 NeMo/runtime 都不支援 160 ms。", "",
        "## 完整句子（12 段）", "",
        "Nemotron 的整句 forward 仍使用指定 chunk attention 設定，不代表無限向後看的離線模式。", "",
        "| 模型／設定 | CER ↓ | 處理 136.02 秒音訊 | RTF ↓ |",
        "|---|---:|---:|---:|",
        f"| Turbo FP16（既有基準） | {turbo['summary']['utterance_cer']:.2%} | {turbo['summary']['utterance_inference_seconds']:.3f} s | {turbo['summary']['utterance_rtf']:.4f} |",
    ]
    for result in models:
        s = result["summary"]
        lines.append(f"| Nemotron {result['protocol']['chunk_ms']} ms FP32 | {s['utterance_cer']:.2%} | {s['utterance_inference_seconds']:.3f} s | {s['utterance_rtf']:.4f} |")
    lines += ["", "## 按播放速度回放（相同前 4 段）", "",
              "| 模型／設定 | 最終 CER ↓ | 首次非空字幕中位時間 | 分塊完成延遲 p95 | 最大排隊 |",
              "|---|---:|---:|---:|---:|"]
    s = prefix["summary"]
    lines.append(f"| Turbo 每 1 秒重辨識前綴 | {s['final_cer']:.2%} | {s['first_caption_p50_seconds']:.3f} s | {s['update_lag_p95_seconds']:.3f} s | {s['max_queue_seconds']:.3f} s |")
    for result in models:
        s = result["summary"]
        lines.append(f"| Nemotron 原生 {result['protocol']['chunk_ms']} ms | {s['streaming_cer']:.2%} | {s['first_caption_p50_seconds']:.3f} s | {s['chunk_lag_p95_seconds']:.3f} s | {s['max_queue_seconds']:.3f} s |")
    lines += ["", "首次字幕從 WAV 起點計時，包含開頭靜音。分塊完成延遲從該塊最後所需音訊到達後計算，不含等待收集該塊的時間，不能稱為逐字延遲或端到端字幕延遲。",
              "Turbo 可修訂前綴，Nemotron 使用原生 cache；更新節奏不同，數字比較的是各自可部署管線，不是同架構控制實驗。Turbo 基準是同日較早的測量，未同步重跑。", "",
              "## 記憶體及靜音", ""]
    for result in models:
        lines.append(f"- {result['protocol']['chunk_ms']} ms：PyTorch peak allocated {result['torch_peak_allocated_mib']:.0f} MiB；整張 GPU 抽樣峰值 {result['device_memory_mib']['sampled_peak']} MiB（包含桌面與其他程式）；3 秒靜音：{result['silence_3s'] or '空白'}。")
    preferred = min(models, key=lambda m: m["summary"]["streaming_cer"])
    if preferred["summary"]["streaming_cer"] > prefix["summary"]["final_cer"]:
        interpretation = "本次小樣本建議暫時保留 Turbo：Nemotron 首字較早、分塊處理較短，但日文字元錯誤較多；沒有把 Electron 預設切換成 Nemotron。"
    else:
        interpretation = "Nemotron 在這次小樣本達到較低 CER，值得繼續以真實會議音訊驗證；尚未切換 Electron 預設。"
    lines += ["", "## 結果解讀與限制", "", interpretation, "",
              "先對照上表的 CER 與首字時間選擇，不以 chunk 設定代替實際字幕延遲。這份 pilot 不能證明任何模型在所有日文會議較好。",
              "樣本是乾淨朗讀，沒有多人重疊、會議術語或真實麥克風噪音。檔案終點由資料集提供，不是已驗證的 VAD；尚未接入 WASAPI/Electron，也未測長會議 cache 成長。",
              "推論後保存原始字幕和時序；報告產生器核對資料集、模型 revision、樣本 ID、CER、尾塊與音訊到達時間。CPU 測試另驗證各塊特徵與整段特徵一致，以及未到達音訊不能改變當前特徵。", "",
              "## 重現與來源", "",
              "執行方式見 [benchmarks/README.md](../../../benchmarks/README.md)。原始結果、checkpoint 設定與 checksum 均在本目錄。", "",
              f"- [NVIDIA 模型及官方使用說明](https://huggingface.co/{MODEL_ID}/tree/{REVISION})，revision `{REVISION}`。",
              "- [FLEURS](https://huggingface.co/datasets/google/fleurs)，CC-BY-4.0，固定樣本與 SHA-256 見 data-manifest.json。",
              "- [先前四模型基準](../2026-09-22/REPORT.zh-TW.md)。", ""]
    (destination / "REPORT.zh-TW.md").write_text("\n".join(lines), encoding="utf-8")
    paths = [p for p in destination.iterdir() if p.name != "checksums.json"]
    paths += [Path(__file__), *[ROOT / "benchmarks" / name for name in
               ("run_nemotron.py", "prepare_nemotron.py", "test_nemotron.py", "prepare.py", "metrics.py", "run.py", "uv.lock")]]
    paths += [baseline / "whisper-turbo.json", baseline / "prefix-replay.json"]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    (destination / "checksums.json").write_text(json.dumps(hashes, indent=2), encoding="utf-8")
    print(destination / "REPORT.zh-TW.md")


if __name__ == "__main__":
    main()

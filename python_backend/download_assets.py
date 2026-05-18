from __future__ import annotations

from argparse import ArgumentParser, Namespace
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zipfile import ZipFile
import json
import shutil
import time


WHISPER_CPP_RELEASE = "v1.8.4"
WHISPER_CPP_CUDA_ASSET = "whisper-cublas-12.4.0-bin-x64.zip"
WHISPER_CPP_CPU_ASSET = "whisper-bin-x64.zip"
ASSET_CHOICES = (
    "faster-whisper",
    "qwen",
    "whisper-cpp-cpu",
    "whisper-cpp-cuda",
    "whisper-cpp-model",
    "whisper-cpp-base-model",
)


def progress(asset_id: str, percent: int, message: str) -> None:
    print(f"ASSET_PROGRESS {asset_id} {percent} {message}", flush=True)


def format_size(size: float) -> str:
    units = ("B", "KB", "MB", "GB")
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Download local model/runtime assets ignored by Git.")
    parser.add_argument("--target-root", type=Path, default=Path("."), help="Root folder for downloaded assets. Default: repo root")
    parser.add_argument("--skip-faster-whisper", action="store_true", help="Skip Systran/faster-whisper-small")
    parser.add_argument("--skip-qwen", action="store_true", help="Skip Qwen/Qwen3-ASR-0.6B")
    parser.add_argument("--skip-whisper-cpp", action="store_true", help="Skip whisper.cpp runtime and ggml model")
    parser.add_argument("--only", choices=ASSET_CHOICES, help="Download only one asset")
    parser.add_argument("--force", action="store_true", help="Remove existing target folders before downloading")
    return parser.parse_args()


def reset_path(path: Path, force: bool) -> None:
    if force and path.exists():
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()


def download_hf_snapshot(asset_id: str, repo_id: str, destination: Path, force: bool) -> None:
    from huggingface_hub import snapshot_download

    reset_path(destination, force)
    if destination.exists():
        progress(asset_id, 100, "Already exists")
        print(f"Already exists: {destination}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    progress(asset_id, 10, "Downloading snapshot")
    print(f"Downloading {repo_id} -> {destination}")
    snapshot_download(repo_id=repo_id, local_dir=destination)
    progress(asset_id, 100, "Done")


def download_hf_file(asset_id: str, repo_id: str, filename: str, destination: Path, force: bool) -> None:
    repo_path = quote(repo_id, safe="/")
    file_path = quote(filename, safe="/")
    url = f"https://huggingface.co/{repo_path}/resolve/main/{file_path}"
    download_url(asset_id, url, destination, force, "file")
    progress(asset_id, 100, "Done")


def github_release_asset_url(tag: str, asset_name: str) -> str:
    url = f"https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/{tag}"
    request = Request(url, headers={"User-Agent": "local-meeting-stt"})
    with urlopen(request) as response:
        release = json.loads(response.read().decode("utf-8"))

    for asset in release["assets"]:
        if asset["name"] == asset_name:
            return asset["browser_download_url"]
    raise SystemExit(f"Asset not found in whisper.cpp {tag}: {asset_name}")


def download_url(asset_id: str, url: str, destination: Path, force: bool, noun: str = "archive") -> None:
    reset_path(destination, force)
    if destination.exists():
        progress(asset_id, 100, "Already exists")
        print(f"Already exists: {destination}")
        return

    partial_destination = destination.with_name(f"{destination.name}.part")
    if force and partial_destination.exists():
        partial_destination.unlink()

    destination.parent.mkdir(parents=True, exist_ok=True)
    existing_size = partial_destination.stat().st_size if partial_destination.exists() else 0
    progress(asset_id, 5, f"Resuming {noun}" if existing_size else f"Downloading {noun}")
    print(f"Downloading {url} -> {destination}")
    headers = {"User-Agent": "local-meeting-stt"}
    if existing_size:
        headers["Range"] = f"bytes={existing_size}-"
    request = Request(url, headers=headers)
    with urlopen(request) as response:
        status = getattr(response, "status", 200)
        if existing_size and status != 206:
            existing_size = 0
            partial_destination.unlink(missing_ok=True)
        content_length = int(response.headers.get("Content-Length") or 0)
        total = content_length + existing_size if status == 206 else content_length
        downloaded = 0
        started = time.monotonic()
        last_progress = 0.0
        with partial_destination.open("ab" if existing_size else "wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                current = existing_size + downloaded
                if total:
                    now = time.monotonic()
                    if now - last_progress >= 0.5:
                        speed = downloaded / max(now - started, 0.001)
                        message = f"{format_size(current)} / {format_size(total)} ({format_size(speed)}/s)"
                        progress(asset_id, min(85, 5 + int(current * 80 / total)), message)
                        last_progress = now
    partial_destination.replace(destination)
    progress(asset_id, 88, f"Downloaded {noun}")


def extract_zip(asset_id: str, zip_path: Path, destination: Path, force: bool) -> None:
    reset_path(destination, force)
    if destination.exists() and any(destination.iterdir()):
        progress(asset_id, 100, "Already extracted")
        print(f"Already exists: {destination}")
        return

    destination.mkdir(parents=True, exist_ok=True)
    progress(asset_id, 90, "Extracting")
    print(f"Extracting {zip_path} -> {destination}")
    with ZipFile(zip_path) as archive:
        archive.extractall(destination)
    progress(asset_id, 100, "Done")


def download_assets(args: Namespace) -> None:
    root = args.target_root.resolve()
    only = args.only

    if (only in (None, "faster-whisper")) and not args.skip_faster_whisper:
        download_hf_snapshot(
            "faster-whisper",
            "Systran/faster-whisper-small",
            root / "models" / "faster-whisper-small",
            args.force,
        )

    if (only in (None, "qwen")) and not args.skip_qwen:
        download_hf_snapshot(
            "qwen",
            "Qwen/Qwen3-ASR-0.6B",
            root / "models" / "Qwen3-ASR-0.6B",
            args.force,
        )

    if (only is None or only.startswith("whisper-cpp-")) and not args.skip_whisper_cpp:
        whisper_cpp_root = root / "whisper_cpp"
        if only in (None, "whisper-cpp-cuda"):
            cuda_zip_path = whisper_cpp_root / "downloads" / WHISPER_CPP_CUDA_ASSET
            cuda_asset_url = github_release_asset_url(WHISPER_CPP_RELEASE, WHISPER_CPP_CUDA_ASSET)
            download_url("whisper-cpp-cuda", cuda_asset_url, cuda_zip_path, args.force)
            extract_zip("whisper-cpp-cuda", cuda_zip_path, whisper_cpp_root / "bin_cuda", args.force)

        if only in (None, "whisper-cpp-cpu"):
            cpu_zip_path = whisper_cpp_root / "downloads" / WHISPER_CPP_CPU_ASSET
            cpu_asset_url = github_release_asset_url(WHISPER_CPP_RELEASE, WHISPER_CPP_CPU_ASSET)
            download_url("whisper-cpp-cpu", cpu_asset_url, cpu_zip_path, args.force)
            extract_zip("whisper-cpp-cpu", cpu_zip_path, whisper_cpp_root / "bin_cpu", args.force)

        if only in (None, "whisper-cpp-model"):
            download_hf_file(
                "whisper-cpp-model",
                "ggerganov/whisper.cpp",
                "ggml-small.bin",
                whisper_cpp_root / "models" / "ggml-small.bin",
                args.force,
            )

        if only in (None, "whisper-cpp-base-model"):
            download_hf_file(
                "whisper-cpp-base-model",
                "ggerganov/whisper.cpp",
                "ggml-base.bin",
                whisper_cpp_root / "models" / "ggml-base.bin",
                args.force,
            )

    print(f"Done. Asset root: {root}")


def main() -> None:
    download_assets(parse_args())


if __name__ == "__main__":
    main()

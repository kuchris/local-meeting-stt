from __future__ import annotations

from argparse import ArgumentParser, Namespace
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile
import json
import shutil


WHISPER_CPP_RELEASE = "v1.8.4"
WHISPER_CPP_CUDA_ASSET = "whisper-cublas-12.4.0-bin-x64.zip"
WHISPER_CPP_CPU_ASSET = "whisper-bin-x64.zip"
ASSET_CHOICES = ("faster-whisper", "qwen", "whisper-cpp-cpu", "whisper-cpp-cuda", "whisper-cpp-model")


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


def download_hf_snapshot(repo_id: str, destination: Path, force: bool) -> None:
    from huggingface_hub import snapshot_download

    reset_path(destination, force)
    if destination.exists():
        print(f"Already exists: {destination}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {repo_id} -> {destination}")
    snapshot_download(repo_id=repo_id, local_dir=destination)


def download_hf_file(repo_id: str, filename: str, destination: Path, force: bool) -> None:
    from huggingface_hub import hf_hub_download

    reset_path(destination, force)
    if destination.exists():
        print(f"Already exists: {destination}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {repo_id}/{filename} -> {destination}")
    downloaded = Path(hf_hub_download(repo_id=repo_id, filename=filename, local_dir=destination.parent))
    if downloaded != destination:
        downloaded.replace(destination)


def github_release_asset_url(tag: str, asset_name: str) -> str:
    url = f"https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/{tag}"
    request = Request(url, headers={"User-Agent": "local-meeting-stt"})
    with urlopen(request) as response:
        release = json.loads(response.read().decode("utf-8"))

    for asset in release["assets"]:
        if asset["name"] == asset_name:
            return asset["browser_download_url"]
    raise SystemExit(f"Asset not found in whisper.cpp {tag}: {asset_name}")


def download_url(url: str, destination: Path, force: bool) -> None:
    reset_path(destination, force)
    if destination.exists():
        print(f"Already exists: {destination}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url} -> {destination}")
    request = Request(url, headers={"User-Agent": "local-meeting-stt"})
    with urlopen(request) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def extract_zip(zip_path: Path, destination: Path, force: bool) -> None:
    reset_path(destination, force)
    if destination.exists() and any(destination.iterdir()):
        print(f"Already exists: {destination}")
        return

    destination.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {zip_path} -> {destination}")
    with ZipFile(zip_path) as archive:
        archive.extractall(destination)


def download_assets(args: Namespace) -> None:
    root = args.target_root.resolve()
    only = args.only

    if (only in (None, "faster-whisper")) and not args.skip_faster_whisper:
        download_hf_snapshot(
            "Systran/faster-whisper-small",
            root / "models" / "faster-whisper-small",
            args.force,
        )

    if (only in (None, "qwen")) and not args.skip_qwen:
        download_hf_snapshot(
            "Qwen/Qwen3-ASR-0.6B",
            root / "models" / "Qwen3-ASR-0.6B",
            args.force,
        )

    if (only is None or only.startswith("whisper-cpp-")) and not args.skip_whisper_cpp:
        whisper_cpp_root = root / "whisper_cpp"
        if only in (None, "whisper-cpp-cuda"):
            cuda_zip_path = whisper_cpp_root / "downloads" / WHISPER_CPP_CUDA_ASSET
            cuda_asset_url = github_release_asset_url(WHISPER_CPP_RELEASE, WHISPER_CPP_CUDA_ASSET)
            download_url(cuda_asset_url, cuda_zip_path, args.force)
            extract_zip(cuda_zip_path, whisper_cpp_root / "bin_cuda", args.force)

        if only in (None, "whisper-cpp-cpu"):
            cpu_zip_path = whisper_cpp_root / "downloads" / WHISPER_CPP_CPU_ASSET
            cpu_asset_url = github_release_asset_url(WHISPER_CPP_RELEASE, WHISPER_CPP_CPU_ASSET)
            download_url(cpu_asset_url, cpu_zip_path, args.force)
            extract_zip(cpu_zip_path, whisper_cpp_root / "bin_cpu", args.force)

        if only in (None, "whisper-cpp-model"):
            download_hf_file(
                "ggerganov/whisper.cpp",
                "ggml-small.bin",
                whisper_cpp_root / "models" / "ggml-small.bin",
                args.force,
            )

    print(f"Done. Asset root: {root}")


def main() -> None:
    download_assets(parse_args())


if __name__ == "__main__":
    main()

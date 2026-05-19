from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
import struct


def repair_pcm_wav_header(path: Path) -> bool:
    size = path.stat().st_size
    if size <= 44 or size > 0xFFFFFFFF:
        return False

    with path.open("r+b") as handle:
        header = handle.read(44)
        if len(header) != 44:
            return False
        if header[0:4] != b"RIFF" or header[8:12] != b"WAVE":
            return False
        if header[12:16] != b"fmt " or header[36:40] != b"data":
            return False
        if struct.unpack_from("<H", header, 20)[0] != 1:
            return False

        riff_size = size - 8
        data_size = size - 44
        current_riff_size = struct.unpack_from("<I", header, 4)[0]
        current_data_size = struct.unpack_from("<I", header, 40)[0]
        if current_riff_size == riff_size and current_data_size == data_size:
            return False

        handle.seek(4)
        handle.write(struct.pack("<I", riff_size))
        handle.seek(40)
        handle.write(struct.pack("<I", data_size))
        return True


def main() -> None:
    parser = ArgumentParser(description="Repair simple PCM WAV RIFF/data sizes.")
    parser.add_argument("wav", type=Path)
    args = parser.parse_args()

    if repair_pcm_wav_header(args.wav):
        print(f"Repaired WAV header: {args.wav}")
    else:
        print(f"WAV header already OK or unsupported: {args.wav}")


if __name__ == "__main__":
    main()

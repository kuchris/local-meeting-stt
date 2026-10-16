"""Runs whisper-cli on a recording, then converts its transcript to the chosen Chinese script.

whisper.cpp writes Mandarin and Cantonese mostly in Simplified; the app's Chinese
characters setting decides. Everything after `--` is the whisper-cli command,
which must write its text with `-otxt -of <base>`.

python post_whisper_cpp.py --chinese-script traditional --language yue -- whisper-cli.exe -m ... -otxt -of out
"""
from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
import subprocess
import sys

from text_script import SCRIPTS, convert_lines


def main() -> None:
    if "--" not in sys.argv:
        raise SystemExit("Usage: post_whisper_cpp.py --chinese-script SCRIPT --language LANG -- whisper-cli ARGS")
    split = sys.argv.index("--")
    parser = ArgumentParser(description="whisper-cli, then Traditional/Simplified conversion of its transcript.")
    parser.add_argument("--chinese-script", choices=SCRIPTS, default="as-is")
    parser.add_argument("--language", default="auto")
    args = parser.parse_args(sys.argv[1:split])
    command = sys.argv[split + 1:]
    if "-of" not in command:
        raise SystemExit("The whisper-cli command needs -of <output base>.")
    code = subprocess.call(command)
    if code != 0:
        raise SystemExit(code)
    output = Path(command[command.index("-of") + 1] + ".txt")
    text = output.read_text(encoding="utf-8")
    output.write_text(convert_lines(text, args.chinese_script, args.language), encoding="utf-8")
    print(f"Converted to {args.chinese_script}: {output}", flush=True)


if __name__ == "__main__":
    main()

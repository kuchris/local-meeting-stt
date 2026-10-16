"""Optional Traditional/Simplified conversion of recognized Chinese captions.

SenseVoice writes Chinese and Cantonese in Simplified characters and Whisper
mixes the two, so the live scripts can convert before printing and saving.
Japanese is left alone: kanji such as 気 or 広 must not become 氣 or 廣.
"""
from __future__ import annotations

import re
from typing import Callable

SCRIPTS = ("as-is", "traditional", "simplified")
_KANA = re.compile(r"[぀-ヿ]")


def converter(script: str, language: str | None = None) -> Callable[[str], str]:
    # A Japanese session is never converted: a kanji-only caption has no kana to tell it apart.
    if script == "as-is" or language == "ja":
        return lambda text: text
    from opencc import OpenCC

    convert = OpenCC("s2hk" if script == "traditional" else "t2s").convert

    def apply(text: str) -> str:
        # Japanese almost always has kana; leave those captions as recognized.
        return text if _KANA.search(text) else convert(text)

    return apply


def convert_lines(text: str, script: str, language: str | None = None) -> str:
    """A whole transcript, line by line, so a Japanese line with kana is kept while
    the Chinese lines around it are converted."""
    convert = converter(script, language)
    return "\n".join(convert(line) for line in text.split("\n"))


def with_script(transcribe: Callable, script: str, language: str | None = None) -> Callable:
    convert = converter(script, language)
    return lambda audio: convert(transcribe(audio))

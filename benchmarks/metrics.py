"""Small, dependency-free scoring and single-worker replay timing helpers."""
import unicodedata


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(c for c in text if not c.isspace() and unicodedata.category(c)[0] not in "PZC")


def edit_distance(reference: str, hypothesis: str) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        current = [i]
        for j, right in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def score(reference: str, hypothesis: str) -> dict:
    ref, hyp = normalize_text(reference), normalize_text(hypothesis)
    errors = edit_distance(ref, hyp)
    return {"errors": errors, "reference_chars": len(ref), "cer": errors / len(ref) if ref else None}


def replay_timing(previous_finish: float, audio_end: float, inference_seconds: float) -> dict:
    start = max(previous_finish, audio_end)
    finish = start + inference_seconds
    return {"start": start, "finish": finish, "queue_seconds": start - audio_end, "lag_seconds": finish - audio_end}

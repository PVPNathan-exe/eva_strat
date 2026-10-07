"""Transforme une suite de booléens (HUD présent ou non, un par échantillon)
en segments (début_s, fin_s)."""


def build_segments(flags, step_s, min_len_s=120.0, gap_tolerance_s=10.0):
    runs = []
    start = None
    for i, present in enumerate(flags):
        if present and start is None:
            start = i
        elif not present and start is not None:
            runs.append([start, i - 1])
            start = None
    if start is not None:
        runs.append([start, len(flags) - 1])

    merged = []
    for run in runs:
        gap_s = (run[0] - merged[-1][1] - 1) * step_s if merged else None
        if gap_s is not None and gap_s <= gap_tolerance_s:
            merged[-1][1] = run[1]
        else:
            merged.append(run)

    return [
        (first * step_s, (last + 1) * step_s)
        for first, last in merged
        if (last + 1 - first) * step_s >= min_len_s
    ]

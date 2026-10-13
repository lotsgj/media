#!/usr/bin/env python3
"""Mirror the player's audio collection folders into media/audio and convert chosen collections to Opus (.ogg).

  python3 scripts/convert_audio.py            convert (skips files already converted and verified)
  python3 scripts/convert_audio.py --verify   only re-check what is in media/audio

Source files are only read. Every folder under the source is recreated; audio from the collections listed in
CONVERT is converted, and audio from those in COPY is copied unchanged. Results are written to media/audio/conversion-report.tsv.
"""
import os
import filecmp
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MEDIA = Path(__file__).resolve().parents[1]
SOURCE = MEDIA.parent / "gita-verse-player/data/collections/audio"
TARGET = MEDIA / "audio"

# collection folder -> ffmpeg audio settings. Collections not listed get their folders but no audio.
CONVERT = {
    "chanting-aj-padma-aj-vijay-learn-mode": ["-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-application", "audio"],
}
# collections whose audio is copied unchanged (already small; re-encoding would only lose quality)
COPY = ["chanting-swami-brahmananda"]
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".ogg"}
DURATION_TOLERANCE = 0.08      # seconds; encoders pad the ends slightly differently
STEREO_SAME_DB = -60.0         # left-minus-right below this means both channels carry the same sound
WORKERS = max(2, (os.cpu_count() or 4) - 2)


def run(args):
    return subprocess.run(args, capture_output=True, text=True)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
               "stream=codec_name,channels:format=duration", "-of", "csv=p=0", str(path)]).stdout.split()
    if len(out) < 2:
        return None
    codec, channels = out[0].split(",")[:2]
    return codec, int(channels), float(out[1])


def channel_difference(path):
    err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
               "pan=mono|c0=0.5*c0-0.5*c1,volumedetect", "-f", "null", "-"]).stderr
    m = re.search(r"mean_volume: (-?[\d.]+|-inf) dB", err)
    return float("-inf") if not m or m.group(1) == "-inf" else float(m.group(1))


def convert(job):
    src, dst, settings, verify_only = job
    s = probe(src)
    if s is None:
        return src, dst, "FAILED", "source could not be read"
    note = ""
    if not verify_only:
        d = probe(dst) if dst.exists() else None
        if not (d and d[0] == "opus" and abs(d[2] - s[2]) <= DURATION_TOLERANCE):
            tmp = dst.with_suffix(".part.ogg")
            r = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vn",
                     "-map_metadata", "-1", *settings, str(tmp)])
            if r.returncode != 0:
                tmp.unlink(missing_ok=True)
                return src, dst, "FAILED", r.stderr.strip().replace("\n", " ")[:200]
            os.replace(tmp, dst)
            if s[1] == 2:
                diff = channel_difference(src)
                if diff > STEREO_SAME_DB:
                    note = f"stereo channels differ ({diff:.0f} dB): mono mix blends them"
    d = probe(dst) if dst.exists() else None
    if d is None:
        return src, dst, "MISSING", "no converted file"
    problems = []
    if d[0] != "opus" or d[1] != 1:
        problems.append(f"unexpected format {d[0]}, {d[1]} channel(s)")
    if abs(d[2] - s[2]) > DURATION_TOLERANCE:
        problems.append(f"duration {d[2]:.2f}s vs source {s[2]:.2f}s")
    if dst.stat().st_size < 2000:
        problems.append("file is almost empty")
    if problems:
        return src, dst, "CHECK", "; ".join(problems)
    return src, dst, "OK", note


def main():
    verify_only = "--verify" in sys.argv
    assert SOURCE.is_dir(), SOURCE
    dirs = [p for p in SOURCE.rglob("*") if p.is_dir()]
    for d in dirs:
        (TARGET / d.relative_to(SOURCE)).mkdir(parents=True, exist_ok=True)
    copied = same = 0
    for collection in COPY:
        for src in sorted((SOURCE / collection).rglob("*")):
            if src.is_file() and src.suffix.lower() in AUDIO_EXT:
                dst = TARGET / src.relative_to(SOURCE)
                if dst.exists() and filecmp.cmp(src, dst, shallow=False):
                    same += 1
                elif verify_only:
                    print(f"  NOT AN EXACT COPY: {dst.relative_to(TARGET)}")
                else:
                    shutil.copy2(src, dst)
                    assert filecmp.cmp(src, dst, shallow=False), dst
                    copied += 1
    if COPY:
        print(f"copied unchanged: {copied} new, {same} already identical ({', '.join(COPY)})")
    jobs = []
    for collection, settings in CONVERT.items():
        for src in sorted((SOURCE / collection).rglob("*")):
            if src.is_file() and src.suffix.lower() in AUDIO_EXT:
                dst = (TARGET / src.relative_to(SOURCE)).with_suffix(".ogg")
                jobs.append((src, dst, settings, verify_only))
    print(f"{len(dirs)} folders mirrored; {len(jobs)} audio files to {'verify' if verify_only else 'convert'} with {WORKERS} workers")
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(convert, jobs))
    src_bytes = sum(r[0].stat().st_size for r in results)
    dst_bytes = sum(r[1].stat().st_size for r in results if r[1].exists())
    lines = ["status\tsource\tconverted\tsource_bytes\tconverted_bytes\tnote"]
    for src, dst, status, note in results:
        lines.append("\t".join([status, str(src.relative_to(SOURCE)), str(dst.relative_to(TARGET)),
                                str(src.stat().st_size), str(dst.stat().st_size if dst.exists() else 0), note]))
    (TARGET / "conversion-report.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    counts = {}
    for r in results:
        counts[r[2]] = counts.get(r[2], 0) + 1
    notes = [r for r in results if r[3]]
    print("results:", counts)
    print(f"source {src_bytes / 1e6:.0f} MB -> converted {dst_bytes / 1e6:.0f} MB ({dst_bytes / src_bytes:.0%})")
    for src, dst, status, note in notes[:20]:
        print(f"  {status}: {src.relative_to(SOURCE)} - {note}")
    if len(notes) > 20:
        print(f"  ... and {len(notes) - 20} more in conversion-report.tsv")


if __name__ == "__main__":
    main()

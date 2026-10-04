#!/usr/bin/env python3
"""Writes library.json for a LumaMap media folder: one sub-folder per category, video files inside.

    python3 build-media-library.py public/media

Titles come from the .titles.tsv that download-media.sh writes; other files are named after the file.
Run it again after adding or removing videos by hand.
"""
import json
import os
import sys

VIDEO_EXTENSIONS = {".mp4", ".webm", ".m4v", ".mov"}


def read_titles(folder):
    titles = {}
    path = os.path.join(folder, ".titles.tsv")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t", 3)
                if len(parts) == 4:
                    video_id, _index, duration, title = parts
                    try:
                        seconds = float(duration)
                    except ValueError:
                        seconds = None  # yt-dlp writes "NA" when it does not know
                    titles[video_id] = (title, seconds)
    return titles


def main():
    media = sys.argv[1] if len(sys.argv) > 1 else "public/media"
    items = []
    for category in sorted(os.listdir(media)):
        folder = os.path.join(media, category)
        if category.startswith(".") or not os.path.isdir(folder):
            continue
        titles = read_titles(folder)
        for name in sorted(os.listdir(folder)):
            stem, ext = os.path.splitext(name)
            if name.startswith(".") or ext.lower() not in VIDEO_EXTENSIONS:
                continue
            # download-media.sh names files "<playlist position>-<YouTube id>.mp4"
            prefix, _, rest = stem.partition("-")
            video_id = rest if rest and (prefix.isdigit() or prefix == "NA") else stem
            title, duration = titles.get(video_id, (stem.replace("_", " "), None))
            item = {
                "category": category,
                "title": title,
                "file": f"{category}/{name}",
                "size": os.path.getsize(os.path.join(folder, name)),
            }
            if duration:
                item["duration"] = duration
            items.append(item)

    with open(os.path.join(media, "library.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "items": items}, f, ensure_ascii=False, indent=2)
    print(f"library.json: {len(items)} videos in {media}")


if __name__ == "__main__":
    main()

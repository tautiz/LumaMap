#!/usr/bin/env bash
# Downloads a YouTube playlist into a LumaMap media folder, as MP4 files a Raspberry Pi plays smoothly
# (H.264, at most 1080p), and writes the list LumaMap reads (library.json).
#
#   bash download-media.sh                                  # the Halloween playlist into the "halloween" category
#   bash download-media.sh "<playlist or video URL>" <category> [media folder]
#
# The media folder is public/media in a LumaMap checkout, otherwise ~/LumaMap-media.
# Running it again only downloads videos that are new in the playlist.
# Then add the videos in LumaMap: "From the video library" -> "Add videos from this computer".
set -euo pipefail

PLAYLIST="${1:-https://www.youtube.com/playlist?list=PLmhowb2JTaol37RpVqORvN45OgfeBnoYj}"
CATEGORY="${2:-halloween}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "${3:-}" ]; then
  MEDIA_DIR="$3"
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../package.json" ]; then
  MEDIA_DIR="$SCRIPT_DIR/../public/media"
else
  MEDIA_DIR="$HOME/LumaMap-media"
fi
OUT="$MEDIA_DIR/$CATEGORY"
mkdir -p "$OUT"
MEDIA_DIR="$(cd "$MEDIA_DIR" && pwd)"

# yt-dlp: YouTube changes often, so use the latest release rather than the (older) system package.
YTDLP="$(command -v yt-dlp || true)"
if [ -z "$YTDLP" ]; then
  YTDLP="$HOME/.local/bin/yt-dlp"
  echo "Installing yt-dlp into $YTDLP"
  mkdir -p "$(dirname "$YTDLP")"
  curl -fL --retry 3 -o "$YTDLP" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  chmod +x "$YTDLP"
else
  "$YTDLP" -U >/dev/null 2>&1 || true
fi

# ffmpeg joins YouTube's separate picture and sound streams into one MP4.
if ! command -v ffmpeg >/dev/null; then
  if command -v apt-get >/dev/null; then
    echo "Installing ffmpeg"
    sudo apt-get install -y ffmpeg
  else
    echo "Please install ffmpeg first (macOS: brew install ffmpeg)" >&2
    exit 1
  fi
fi

echo "Downloading $PLAYLIST into $OUT"
# -S prefers H.264 up to 1080p with AAC sound: the Pi 4 decodes H.264 in hardware, and anything
# bigger than the projector only costs CPU. Files over 95 MB are skipped: GitHub refuses files over
# 100 MB. Titles go to .titles.tsv for library.json.
"$YTDLP" \
  --yes-playlist --ignore-errors --no-overwrites --no-simulate \
  -f "bv*+ba/b" -S "res:1080,vcodec:h264,acodec:aac,ext:mp4" --merge-output-format mp4 \
  --max-filesize 95M \
  -o "$OUT/%(playlist_index)03d-%(id)s.%(ext)s" \
  --print-to-file "%(id)s	%(playlist_index)s	%(duration)s	%(title)s" "$OUT/.titles.tsv" \
  "$PLAYLIST" || echo "Some videos could not be downloaded (see above); continuing with the rest."

BUILDER="$SCRIPT_DIR/build-media-library.py"
if [ -z "$SCRIPT_DIR" ] || [ ! -f "$BUILDER" ]; then
  # Run through curl | bash: fetch the list builder too.
  BUILDER="$MEDIA_DIR/.build-media-library.py"
  curl -fsSL https://raw.githubusercontent.com/tautiz/LumaMap/main/scripts/build-media-library.py -o "$BUILDER"
fi
python3 "$BUILDER" "$MEDIA_DIR"

echo
echo "Done. Videos are in: $OUT"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../package.json" ] && [ -z "${3:-}" ]; then
  echo "To publish them with the site: git add public/media && git commit -m \"Add $CATEGORY videos\" && git push"
else
  echo "In LumaMap: select a layer -> \"From the video library\" -> \"Add videos from this computer\", pick these files."
fi

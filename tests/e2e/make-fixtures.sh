#!/usr/bin/env bash
# Test videos that show their own frame number as 8 black/white stripes (stripe k is white when bit k of
# the frame number is set), so the export test can read back which source frame each exported frame
# shows, however the colours shift in encoding. Needs ffmpeg with libvpx.
set -euo pipefail
out="${1:-$(dirname "$0")/fixtures}"
mkdir -p "$out"
make() { # name rate frames
  ffmpeg -loglevel error -y -f lavfi -i "color=black:s=64x64:r=$2" -frames:v "$3" \
    -vf "geq=lum='if(mod(floor(N/pow(2,floor(X/8))),2),235,16)':cb=128:cr=128" -c:v libvpx-vp9 -lossless 1 -pix_fmt yuv420p "$out/$1.mp4"
}
make a24 24 36             # 1.5 s at 24 fps
make b30 30 20             # 0.666... s at 30 fps
make c2997 30000/1001 30   # 1.001 s at 29.97 fps
make d23976 24000/1001 48  # 2.002 s at 23.976 fps

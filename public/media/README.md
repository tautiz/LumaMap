# Media folder

LumaMap lists the videos in this folder in its video library. Layout: one sub-folder per category
(`halloween/`, ...) with `.mp4` or `.webm` files, and `library.json`, which lists them.

- `scripts/download-media.sh` downloads a YouTube playlist here and writes `library.json`.
- After adding or removing files by hand, run `python3 scripts/build-media-library.py public/media`.

Videos are not committed (see `.gitignore`): they are large, and the public site must not republish
videos we have no right to share. If a video is your own, you can commit it together with `library.json`,
and the GitHub Pages site will list it too (GitHub refuses files over 100 MB).

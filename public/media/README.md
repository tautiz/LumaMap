# Media folder

LumaMap lists the videos in this folder in its video library. Layout: one sub-folder per category
(`halloween/`, ...) with `.mp4` or `.webm` files, and `library.json`, which lists them.

- `scripts/download-media.sh` downloads a YouTube playlist here and writes `library.json`.
- After adding or removing files by hand, run `python3 scripts/build-media-library.py public/media`.

This folder is committed: the GitHub Pages site serves it, so every video here shows up in the library
online. GitHub refuses files over 100 MB (the script skips them) and Pages sites should stay under 1 GB.
The repository is public: only commit videos you are allowed to share.

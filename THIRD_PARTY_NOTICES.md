# Third-party notices

Vetch is licensed under the MIT License. The desktop installers also bundle
the standalone third-party executables listed below. Those programs are
separate works and remain governed by their own licenses.

## Bundled executables

| Component | Purpose | License | Upstream source |
| --- | --- | --- | --- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Media extraction and downloading | The Unlicense | <https://github.com/yt-dlp/yt-dlp> |
| [FFmpeg / FFprobe](https://ffmpeg.org/) | Media probing, conversion, and muxing | GNU GPL v3 or later for the bundled GPL builds | <https://github.com/FFmpeg/FFmpeg> |
| [Deno](https://deno.com/) | JavaScript runtime used by yt-dlp extractors | MIT | <https://github.com/denoland/deno> |

Copies of these licenses are included in the [`LICENSES`](LICENSES)
directory and in packaged Vetch applications. The exact binary versions,
download locations, and integrity hashes used for a release are maintained by
the binary setup tooling in this repository.

## FFmpeg corresponding source

Vetch distributions use GPL-enabled FFmpeg builds supplied by
[yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) on Windows and
Linux and by [eko5624/mpv-mac](https://github.com/eko5624/mpv-mac) on macOS.
The build projects, their build scripts, and the corresponding FFmpeg source
are available without charge from the links above and from the exact upstream
source revision identified by each binary version.

Anyone redistributing a Vetch installer must keep the applicable license texts
with the installer and provide equivalent, durable access to the complete
corresponding source and build scripts for the FFmpeg binaries they distribute,
as required by section 6 of GPL v3.

## Other dependencies

Vetch also incorporates open-source Rust and JavaScript dependencies recorded
in `src-tauri/Cargo.lock` and `pnpm-lock.yaml`. Their copyright notices and
license terms remain applicable. Source distributions retain the dependency
metadata needed to identify the exact versions used by a release.

The names and trademarks of third-party projects belong to their respective
owners. Inclusion here does not imply endorsement.

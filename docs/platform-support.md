# Platform support

Vetch is a desktop application. Official release artifacts are built on the
native GitHub-hosted runners shown below.

| Operating system | Official architecture | Package formats | Minimum / notes |
| --- | --- | --- | --- |
| macOS | Apple Silicon (`arm64`) | `.dmg` | macOS 11 or later; unsigned |
| Windows | `x64` | `.msi`, NSIS `.exe` | A supported Windows version with WebView2 |
| Linux | `x64` | `.AppImage`, `.deb`, `.rpm` | Runtime compatibility depends on the selected package and distribution |

The source setup manifest also supports local Intel Mac (`x64`) builds. The
setup command intentionally stops with an unsupported-platform error instead
of downloading a binary for a different CPU architecture.

Windows ARM64 and Linux ARM64 are not currently published or supported as
complete Vetch application targets. Individual upstream tools may provide
ARM64 binaries, but an architecture is not considered supported until the
complete application is built and tested on a native CI runner.

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for
the system packages required when building from source.

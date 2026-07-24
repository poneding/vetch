<div align="center">
  <a href="https://github.com/poneding/vetch">
    <img src="src-tauri/icons/vetch.svg" alt="Vetch" width="96" height="96">
  </a>

  <h1>Vetch</h1>

  <p>
    <a href="README.md">English</a> | <strong>简体中文</strong>
  </p>

  <p>
    一款专注、强大、跨平台的媒体下载器。
  </p>

  <p>
    <a href="https://github.com/poneding/vetch/releases/latest"><img src="https://img.shields.io/github/v/release/poneding/vetch?color=7c3aed&labelColor=1e1b24&logo=github&label=Release" alt="最新版本" /></a>
    <a href="https://github.com/poneding/vetch/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/poneding/vetch/ci.yml?branch=main&color=7c3aed&labelColor=1e1b24&logo=github&label=CI" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-7c3aed?labelColor=1e1b24" alt="MIT 许可证" /></a>
    <a href="https://tauri.app"><img src="https://img.shields.io/badge/Built%20with-Tauri%202-24c8db?labelColor=1e1b24&logo=tauri" alt="Tauri" /></a>
  </p>
</div>

## 截图

| | |
| --- | --- |
| ![Vetch 截图](docs/images/1784854795032.png) | ![Vetch 截图](docs/images/1784854816929.png) |
| ![Vetch 截图](docs/images/1784855386120.png) | ![Vetch 截图](docs/images/1784855484326.png) |

通过简洁的桌面界面从 **1000 多个网站**下载视频和音频——粘贴链接、选择质量，即可完成。无需账号，不收集分析数据，一切内容都保留在你的设备上。

主界面为下载队列。设置和关于页面会从标题栏以紧凑面板的形式打开。

## 功能特性

- 通过 yt-dlp 支持 **1000 多个网站**——YouTube、哔哩哔哩、TikTok、X 等
- 支持**视频和音频**下载，可选择质量预设、封装格式、精确格式及首选语言
- 支持**播放列表**条目选择，并可**手动刷新**以获取新增内容
- 支持**暂停 / 继续**、取消、重试，并实时显示速度和预计剩余时间
- **内置媒体浏览器**，可嗅探浏览页面中的 HLS、DASH 及其他媒体资源
- 支持 Cookie、代理、并发数、文件名模板、字幕、元数据、章节和缩略图
- 支持**时间范围剪辑**以及为每个下载任务单独设置输出选项
- 历史记录和设置**本地优先** · 支持浅色 / 深色 / 跟随系统主题
- 可选通过 GitHub Releases 检查更新

## 下载

最新版本安装包：

| 平台 | 架构 | 安装包格式 |
| --- | --- | --- |
| macOS 11+ | Apple Silicon (`arm64`) | `.dmg` |
| Windows | `x64` | `.msi` / NSIS `.exe` |
| Linux | `x64` | `.AppImage` / `.deb` / `.rpm` |

→ [GitHub Releases](https://github.com/poneding/vetch/releases/latest)

完整的源码构建与不支持架构说明请参阅[平台支持策略](docs/platform-support.md)。

> **macOS：** CI 构建未签名。首次打开时，请右键点击应用并选择“打开”，或运行：
>
> `xattr -dr com.apple.quarantine /Applications/Vetch.app`

## 开发

**环境要求：**Node.js 22+、pnpm 11.1.2、Rust stable，以及 [Tauri 开发环境依赖](https://v2.tauri.app/start/prerequisites/)。Corepack 会读取 `package.json` 中声明的准确 pnpm 版本。

```bash
pnpm install
pnpm run setup    # 下载适用于当前操作系统和架构的 yt-dlp、FFmpeg、FFprobe 与 Deno
pnpm run dev      # 启动 Tauri 桌面应用
```

```bash
pnpm run check    # lint + i18n + tsc + cargo check
pnpm test
pnpm run build    # 构建生产版本安装包
```

推送版本标签（例如 `v0.1.0`）即可触发多平台 CI 发布构建。更新日志由 [git-cliff](https://git-cliff.org/) 生成。

## 参与贡献

欢迎提交 Issue 和 Pull Request。请参阅[贡献指南](CONTRIBUTING.md)。

安全漏洞必须按照[安全策略](SECURITY.md)进行私下报告。

## 合法使用

请仅下载你有权访问和保存的内容。你有责任遵守著作权法律、来源网站的服务条款以及适用于相关内容的其他规定。Vetch 不授予任何第三方媒体权利，也不会免除用户应承担的法律义务。

## 许可证

[MIT](LICENSE) © Vetch Contributors

项目内置的第三方二进制程序及其源码信息继续遵循各自的许可证，详见[第三方声明](THIRD_PARTY_NOTICES.md)。

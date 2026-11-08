VoiceBoxPlus 0.7.0 — a community fork of [Voicebox](https://github.com/jamiepine/voicebox).

## Download / 下载

| System | Installer |
| --- | --- |
| Mac with Apple Silicon (M1 or newer) | `VoiceBoxPlus-macos-arm64.dmg` |
| Mac with Intel processor | `VoiceBoxPlus-macos-x64.dmg` |
| Windows 10/11 x64 | `VoiceBoxPlus-windows-x64.exe` |
| Ubuntu 22.04+ / compatible Debian x64 | `VoiceBoxPlus-linux-x64.deb` |

These are compiled desktop installers with a bundled Python backend. You do not need Python, Rust, Bun, or a compiler. Model weights are downloaded separately from inside the app.

以上均为编译好的桌面安装包，内含 Python 后端，无需用户安装 Python、Rust、Bun 或自行编译。大模型权重需要进入 App 后下载。

## First run / 首次使用

Open **Quick start / 入门与模板**, download **Qwen VoiceDesign 1.7B** (about 3.5 GB), then choose one of the 16 Chinese presenter templates or describe your own voice. Only the selected voice is added; its dedicated preview is generated locally. Voices and recordings from the developer’s computer are not included.

打开「入门与模板」，下载 Qwen VoiceDesign 1.7B（约 3.5 GB），选择内置中文主播模板，或自行描述音色。只添加你选择的音色，并在本机生成独立试听，不附带开发者电脑中的私人音色或录音。

[中文安装与使用教程](https://github.com/badboy-tian/VoiceBoxPlus/blob/voiceboxplus/docs/getting-started.zh-CN.md) · [English guide](https://github.com/badboy-tian/VoiceBoxPlus/blob/voiceboxplus/docs/getting-started.md)

## Signing and verification / 签名与验证

This community release is not Apple-notarized or Windows Authenticode-signed. macOS packages use ad-hoc signing. The operating system may require its normal “Open Anyway” / “More info” flow. Verify the matching `.sha256` checksum before installation. No auto-updater is enabled.

本社区版本尚未提供 Apple 公证或 Windows 开发者证书签名，macOS 使用临时签名。系统可能要求通过正常的「仍要打开」或「更多信息」流程确认。请核对对应的 `.sha256` 文件。暂未启用自动更新。

Each platform passes frontend type checks, data-preservation tests, and a frozen-backend startup/API smoke test in CI before publication. This does not mean that full model inference or desktop interaction has been tested on every hardware configuration. Windows and Linux installers include CPU PyTorch; separate CUDA/ROCm acceleration packages are not part of this release. CPU generation can be slow, particularly on Intel Macs.

各平台发布前均执行类型检查、数据保留测试及打包后端启动/API 冒烟测试。CI 验证不等于已在所有硬件上实测模型推理和桌面交互。Windows、Linux 安装包使用 CPU PyTorch，本次不提供独立 CUDA/ROCm 加速包；CPU 推理可能较慢，尤其是 Intel Mac。

## Included improvements / 主要改进

- First-run model guide and 16 built-in presenter templates.
- Natural-language voice design and editable per-profile preview scripts.
- Separate tone, emotion, and pace presets.
- Script revisions that preserve original audio.
- Profile filters, stable card ordering, opaque editors, and repaired waveform lifecycle.
- Existing Voice Design app data is retained under `sh.voicebox.app.voicedesign`.

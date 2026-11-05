# ripgrep

OpenCode 的 grep、glob 工具依赖 ripgrep：内核先找 PATH，再找自己的 bin 目录，都没有就从 GitHub 下载，内网下载不了。所以 kits 随应用带一份，启动内核时把它所在的目录加到 PATH 最前面，Agent 跑的命令也能用 `rg`。

- 版本：15.1.0，和 OpenCode 1.19.5 下载的版本一致。升级 OpenCode 时核对这里。
- 来源：<https://github.com/BurntSushi/ripgrep/releases/tag/15.1.0>，`ripgrep-15.1.0-x86_64-pc-windows-msvc.zip`，压缩包的 SHA-256 和发布页的 `.sha256` 一致。
- `win-x64/rg.exe` 的 SHA-256：`decdd4992f3f1b9a5ef9898f1b40ab16886d579d6516b4efd3d5eaa19364e408`
- 许可证：MIT（`LICENSE-MIT`），ripgrep 同时以 Unlicense 发布。

目录名是 electron-builder 的 `${os}-${arch}`，`pnpm vendor:kernel` 把当前平台的目录拷到 `vendor/ripgrep/` 供打包。只放了内网用的 Windows x64；其他平台没有这个目录，安装包里不带，内核走原来的查找顺序。

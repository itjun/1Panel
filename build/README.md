# Build Directory

The build directory is used to house all the build files and assets for your application. 

The structure is:

* bin - Output directory
* darwin - macOS specific files
* windows - Windows specific files

## Mac

The `darwin` directory holds files specific to Mac builds.
These may be customised and used as part of the build. To return these files to the default state, simply delete them
and
build with `wails build`.

The directory contains the following files:

- `Info.plist` - the main plist file used for Mac builds. It is used when building using `wails build`.
- `Info.dev.plist` - same as the main plist file but used when building using `wails dev`.

macOS 打包需要 Python 3。`darwin:package` 和开发启动会在复制 plist 后、代码签名前，
用 `scripts/macos-bundle-version.py` 写入两个系统版本字段。版本与应用内版本共用
`git describe --tags --always`：`v1.3.2` 写为 `1.3.2`，预发布或本地提交后缀不写入系统字段，
没有版本 tag 的开发构建使用 `0.0.0`。模板中的 `0.0.0` 只作占位，修改 plist 后必须重新签名。
发布 CI 会独立核对实际 bundle 的两个字段是否与发布 tag 一致，并验证代码签名。

免费分发使用 ad-hoc 签名，不代表通过 Apple 公证；用户首次运行按 README 在系统设置中手动确认。
本地执行 `task darwin:package:dmg ARCH=arm64` 生成 `bin/1Panel.dmg`；发布 CI 使用同一个
`darwin:create:dmg` 任务，可通过 `DMG_OUTPUT` 指定文件名。底层脚本为
`scripts/package-macos-dmg.sh`：用 `ditto` 保留应用权限与签名，在 DMG 根目录放入
`Applications` 替身及 `docs/macos-install.html`（命名为 `安装指南.html`），然后只读挂载
最终映像，复核签名、执行权限、应用文件和指南内容。任何检查失败都会阻止发布。
指南位于应用外部，签名之后不再修改 `.app`。该检查验证包的完整性，不把 Gatekeeper
信任评估当作已公证应用验收；真实首次放行需在默认安全设置的另一台 Mac 上验证。

## Windows

The `windows` directory contains the manifest and rc files used when building with `wails build`.
These may be customised for your application. To return these files to the default state, simply delete them and
build with `wails build`.

- `icon.ico` - The icon used for the application. This is used when building using `wails build`. If you wish to
  use a different icon, simply replace this file with your own. If it is missing, a new `icon.ico` file
  will be created using the `appicon.png` file in the build directory.
- `installer/*` - The files used to create the Windows installer. These are used when building using `wails build`.
- `info.json` - Application details used for Windows builds. The data here will be used by the Windows installer,
  as well as the application itself (right click the exe -> properties -> details)
- `wails.exe.manifest` - The main application manifest file.

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

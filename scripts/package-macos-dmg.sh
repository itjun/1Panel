#!/bin/bash
# 本地与 CI 共用：保留应用签名打包，并从最终 DMG 复核可安装内容。
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "用法：bash scripts/package-macos-dmg.sh <1Panel.app> <输出.dmg>" >&2
  exit 1
fi

app_path="$1"
dmg_path="$2"
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
guide_path="$repo_dir/docs/macos-install.html"

if [[ "$(uname -s)" != Darwin ]]; then
  echo "DMG 打包与签名验证必须在 macOS 上运行" >&2
  exit 1
fi
if [[ ! -d "$app_path" || ! -f "$guide_path" || "$dmg_path" != *.dmg ]]; then
  echo "请检查应用目录、安装指南与 .dmg 输出路径" >&2
  exit 1
fi

app_name="$(basename "$app_path")"
plist_path="$app_path/Contents/Info.plist"
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist_path")"
if [[ "$executable" == */* || ! -x "$app_path/Contents/MacOS/$executable" ]]; then
  echo "应用主程序不存在或缺少执行权限" >&2
  exit 1
fi
# 完整性校验不等于 Apple 公证；免费分发仍由用户在系统设置中手动放行。
/usr/bin/codesign --verify --deep --strict "$app_path"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/1panel-package.XXXXXX")"
stage_dir="$work_dir/stage"
mount_dir="$work_dir/mount"
is_mounted=false
cleanup() {
  if [[ "$is_mounted" == true ]]; then
    if ! /usr/bin/hdiutil detach "$mount_dir" -quiet; then
      echo "无法卸载验证卷，保留临时目录：$work_dir" >&2
      return 1
    fi
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p "$stage_dir" "$mount_dir" "$(dirname "$dmg_path")"
# ditto 保留权限、符号链接与签名；签名后的 .app 不再写入指南或其他资源。
/usr/bin/ditto "$app_path" "$stage_dir/$app_name"
cp "$guide_path" "$stage_dir/安装指南.html"
ln -s /Applications "$stage_dir/Applications"
/usr/bin/codesign --verify --deep --strict "$stage_dir/$app_name"

/usr/bin/hdiutil create -volname "1Panel" -srcfolder "$stage_dir" -ov -format UDZO "$work_dir/package.dmg"
/usr/bin/hdiutil verify "$work_dir/package.dmg"
/usr/bin/hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mount_dir" "$work_dir/package.dmg"
is_mounted=true

/usr/bin/codesign --verify --deep --strict "$mount_dir/$app_name"
test -x "$mount_dir/$app_name/Contents/MacOS/$executable"
test "$(readlink "$mount_dir/Applications")" = /Applications
cmp "$guide_path" "$mount_dir/安装指南.html"
cmp "$plist_path" "$mount_dir/$app_name/Contents/Info.plist"
cmp "$app_path/Contents/MacOS/$executable" "$mount_dir/$app_name/Contents/MacOS/$executable"
/usr/bin/lipo -archs "$mount_dir/$app_name/Contents/MacOS/$executable"

/usr/bin/hdiutil detach "$mount_dir" -quiet
is_mounted=false
# 验证通过后才生成对外使用的产物，避免把不完整的磁盘映像上传到 Release。
mv -f "$work_dir/package.dmg" "$dmg_path"
echo "DMG 验证通过（签名完整性、执行权限、应用程序替身与离线安装指南）：$dmg_path"

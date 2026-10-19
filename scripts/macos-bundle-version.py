#!/usr/bin/env python3
"""Write the Git application version into a copied macOS Info.plist before signing."""

import argparse
from pathlib import Path
import plistlib
import re


def bundle_version(version):
    match = re.fullmatch(
        r"v?([0-9]+\.[0-9]+\.[0-9]+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?",
        version,
    )
    if match:
        return match.group(1)
    if version == "dev" or re.fullmatch(r"[0-9a-f]{4,40}", version):
        return "0.0.0"
    raise ValueError(f"无法从应用版本解析 macOS 系统版本：{version!r}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plist", type=Path)
    parser.add_argument("version", help="与应用内版本相同的 git describe 输出")
    args = parser.parse_args()
    version = bundle_version(args.version)
    data = args.plist.read_bytes()
    # Wails 模板以 DOCTYPE 开头；plistlib 自动识别 XML 时需要 XML 声明。
    if data.lstrip().startswith(b"<!DOCTYPE"):
        data = b'<?xml version="1.0" encoding="UTF-8"?>\n' + data
    info = plistlib.loads(data)
    for key in ("CFBundleShortVersionString", "CFBundleVersion"):
        if key not in info:
            raise ValueError(f"{args.plist} 缺少 {key}")
        info[key] = version
    args.plist.write_bytes(plistlib.dumps(info, sort_keys=False))
    print(f"macOS bundle version: {version} ({args.version})")


if __name__ == "__main__":
    main()

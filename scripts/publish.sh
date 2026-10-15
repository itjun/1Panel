#!/usr/bin/env bash
# 直接发布到 GitHub Releases。
# 不写版本号时，取最新正式 tag 的补丁号加一，并用自那个 tag 以来的提交标题生成更新说明，
# 然后交给 scripts/release.sh：预检、打附注 tag、推送、等待构建、校验更新清单。
#
#   scripts/publish.sh
#   scripts/publish.sh v1.3.0
#   scripts/publish.sh -m "说明"
#   scripts/publish.sh v1.3.0 -F notes.md
#
# 依赖与 release.sh 相同：git、gh（已登录）、go。
set -euo pipefail

cd "$(dirname "$0")/.."

die() { echo "publish: $*" >&2; exit 1; }

VERSION=""
NOTE_FLAG=""
NOTE_VALUE=""
NOTES_FILE=""
cleanup() {
  if [ -n "$NOTES_FILE" ]; then
    rm -f "$NOTES_FILE"
  fi
}
trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    -m)
      [ -n "${2:-}" ] || die "-m 缺少说明"
      NOTE_FLAG="-m"
      NOTE_VALUE="$2"
      shift 2
      ;;
    -F)
      [ -s "${2:-}" ] || die "说明文件不存在或为空：${2:-}"
      NOTE_FLAG="-F"
      NOTE_VALUE="$2"
      shift 2
      ;;
    v*)
      [ -z "$VERSION" ] || die "版本号只能给一次：$1"
      VERSION="$1"
      shift
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

git fetch origin main --tags --quiet
PREV="$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
[ -n "$PREV" ] || die "找不到上一个正式版本 tag"

if [ -z "$VERSION" ]; then
  rest="${PREV#v}"
  major="${rest%%.*}"
  rest="${rest#*.}"
  minor="${rest%%.*}"
  patch="${rest#*.}"
  VERSION="v${major}.${minor}.$((10#$patch + 1))"
fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "版本号须形如 v1.2.0 或 v1.2.0-rc.1：${VERSION}"

if [ -z "$NOTE_FLAG" ]; then
  subjects="$(git log "${PREV}..HEAD" --no-merges --format='%s')"
  [ -n "$subjects" ] || die "自 ${PREV} 以来没有新提交，无需发布"
  NOTES_FILE="$(mktemp)"
  {
    printf '%s\n\n' "$VERSION"
    printf '%s\n' "$subjects" | while IFS= read -r subject; do
      [ -n "$subject" ] || continue
      printf -- '- %s\n' "$subject"
    done
  } > "$NOTES_FILE"
  NOTE_FLAG="-F"
  NOTE_VALUE="$NOTES_FILE"
fi

echo "上一个版本：${PREV}，即将发布：${VERSION}"
if [ "$NOTE_FLAG" = "-F" ]; then
  echo "更新说明："
  cat "$NOTE_VALUE"
fi

scripts/release.sh "$VERSION" "$NOTE_FLAG" "$NOTE_VALUE"

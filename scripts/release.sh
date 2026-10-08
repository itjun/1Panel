#!/usr/bin/env bash
# 一键发版：预检 → 打附注 tag → 推送 → 等待 Release 工作流 → 校验已发布的更新清单。
#
#   scripts/release.sh v1.2.0                 # 打开编辑器填写更新说明
#   scripts/release.sh v1.2.0 -F notes.md     # 更新说明取自文件
#   scripts/release.sh v1.2.0 -m "说明"        # 更新说明直接给出
#
# 更新说明即附注 tag 的内容，会显示在客户端更新弹窗与 GitHub Release 页。
# 依赖：git、gh（已登录）、go。
set -euo pipefail

cd "$(dirname "$0")/.."

die() { echo "release: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

VERSION="${1:-}"
[ -n "$VERSION" ] || die "用法: scripts/release.sh vX.Y.Z [-F 说明文件 | -m 说明]"
shift
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "版本号须形如 v1.2.0 或 v1.2.0-rc.1：$VERSION"

TAG_ARGS=()
case "${1:-}" in
  "") ;;
  -F) [ -s "${2:-}" ] || die "说明文件不存在或为空：${2:-}"; TAG_ARGS=(-F "$2") ;;
  -m) [ -n "${2:-}" ] || die "-m 缺少说明"; TAG_ARGS=(-m "$2") ;;
  *) die "未知参数：$1" ;;
esac

step "预检"
command -v gh >/dev/null || die "未安装 gh"
gh auth status >/dev/null 2>&1 || die "gh 未登录，先执行 gh auth login"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "仓库：$REPO"

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "请在 main 分支发版"
git diff --quiet && git diff --cached --quiet || die "存在未提交的改动"
git fetch origin main --tags --quiet
git merge-base --is-ancestor origin/main HEAD || die "本地 main 落后或偏离 origin/main，先同步"
git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null && die "本地已存在 tag $VERSION"
git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1 && die "远端已存在 tag $VERSION"

PREV="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$PREV" ] && [[ "$VERSION" != *-* ]]; then
  [ "$(printf '%s\n%s\n' "$PREV" "$VERSION" | sort -V | tail -1)" = "$VERSION" ] || die "$VERSION 不高于上一个版本 $PREV"
fi

gh secret list -R "$REPO" | grep -q "^UPDATE_SIGN_KEY[[:space:]]" || die "仓库未配置 Secret UPDATE_SIGN_KEY"
go run ./cmd/agentversion check
echo "上一个版本：${PREV:-无}，待发布：$VERSION（$(git rev-parse --short HEAD)）"

step "打附注 tag 并推送"
git tag -a "$VERSION" ${TAG_ARGS[@]+"${TAG_ARGS[@]}"}
[ -n "$(git for-each-ref "refs/tags/$VERSION" --format='%(contents)')" ] || { git tag -d "$VERSION"; die "更新说明为空，已撤销 tag"; }
git push origin HEAD:main "refs/tags/$VERSION"

step "等待 Release 工作流"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list -R "$REPO" --workflow release.yml --event push --limit 20 \
    --json databaseId,headBranch -q ".[] | select(.headBranch == \"$VERSION\") | .databaseId" | head -1)"
  [ -n "$RUN_ID" ] && break
  sleep 5
done
[ -n "$RUN_ID" ] || die "未找到 $VERSION 对应的工作流，请到 https://github.com/$REPO/actions 查看"
echo "工作流：https://github.com/$REPO/actions/runs/$RUN_ID"
gh run watch "$RUN_ID" -R "$REPO" --exit-status --interval 30 || die "工作流失败：gh run view $RUN_ID -R $REPO --log-failed"

step "校验已发布的更新清单"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
gh release download "$VERSION" -R "$REPO" -p 'latest.json*' -D "$TMP"
go run ./cmd/releasetool verify -in "$TMP/latest.json" -sig "$TMP/latest.json.sig"
if [[ "$VERSION" != *-* ]]; then
  LIVE="$(curl -fsSL "https://github.com/$REPO/releases/latest/download/latest.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)"
  [ "$LIVE" = "$VERSION" ] || die "客户端更新源返回的版本是 ${LIVE:-空}，预期 $VERSION"
  echo "客户端更新源已指向 $VERSION"
fi

gh release view "$VERSION" -R "$REPO" --json url,assets -q '.url, (.assets[] | "  \(.name)  \(.size)")'

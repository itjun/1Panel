// 下载清单在 Pages 部署时读取 GitHub 最新正式版；读取失败时保留发布页入口。
async function loadRelease() {
  try {
    const response = await fetch("release.json");
    if (!response.ok) throw new Error(`Release metadata: ${response.status}`);
    const release = await response.json();
    if (typeof release.version !== "string" || !Array.isArray(release.assets)) return;
    const version = document.querySelector("[data-version]");
    version.textContent = release.version;
    for (const link of document.querySelectorAll("[data-download]")) {
      const asset = release.assets.find(item =>
        typeof item.name === "string" && item.name.endsWith(link.dataset.download) &&
        typeof item.url === "string" && item.url.startsWith("https://github.com/itjun/1Panel/releases/download/")
      );
      if (asset) link.href = asset.url;
    }
  } catch {
    // 离线或清单不可用时，用户仍可从静态链接进入 GitHub Releases。
  }
}

loadRelease();

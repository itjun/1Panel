const TEXT_EXTS = new Set([
  "txt", "text", "md", "markdown", "mdx", "rst", "log", "csv", "tsv",
  "json", "jsonc", "json5", "xml", "html", "htm", "css", "scss", "less", "sass",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte", "astro",
  "py", "pyi", "rb", "php", "go", "rs", "java", "kt", "kts", "scala", "groovy",
  "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm", "cs", "swift",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "config", "properties", "env",
  "gitignore", "gitattributes", "dockerignore", "editorconfig", "npmrc", "nvmrc",
  "nginx", "service", "timer", "socket", "plist", "gradle", "mod", "sum",
  "svg", "tex", "r", "lua", "pl", "pm", "ex", "exs", "erl", "hs", "clj", "vim",
  "mk", "cmake", "tf", "hcl", "proto", "graphql", "gql", "htaccess",
  "diff", "patch", "reg", "desktop", "spec", "lock",
]);

const TEXT_NAMES = new Set([
  "makefile", "dockerfile", "containerfile", "license", "readme", "changelog",
  "authors", "copying", "gemfile", "rakefile", "procfile", "vagrantfile",
  "jenkinsfile", "brewfile", "hosts", "crontab",
  ".gitignore", ".gitattributes", ".dockerignore", ".editorconfig",
  ".npmrc", ".yarnrc", ".nvmrc", ".bashrc", ".zshrc", ".profile",
  ".bash_profile", ".vimrc", ".gitconfig", ".env",
]);

/** 按文件名判断能否当文本预览。压缩包、图片等不打开预览。 */
export function isTextFileName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower || lower === "." || lower === "..") return false;
  if (TEXT_NAMES.has(lower)) return true;
  if (lower.startsWith(".env")) return true;
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot === lower.length - 1) return false;
  return TEXT_EXTS.has(lower.slice(dot + 1));
}

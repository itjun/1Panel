/** 本机应用进程：按常用开发语言分类（与后端 DetectRuntime 对齐） */

export const LOCAL_LANG_OPTIONS = [
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "go", label: "Go" },
  { value: "python", label: "Python" },
  { value: "csharp", label: "C#" },
  { value: "swift", label: "Swift" },
  { value: "ccpp", label: "C/C++" },
  { value: "objc", label: "ObjC" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
] as const;

export type LocalLangId = (typeof LOCAL_LANG_OPTIONS)[number]["value"];

export function localLangLabel(rt: string): string {
  for (const o of LOCAL_LANG_OPTIONS) {
    if (o.value === rt) return o.label;
  }
  // 兼容旧数据
  if (rt === "node" || rt === "bun" || rt === "npm" || rt === "deno") {
    return "JavaScript";
  }
  if (rt === "c" || rt === "cpp") return "C/C++";
  return rt || "—";
}

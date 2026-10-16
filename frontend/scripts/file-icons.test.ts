import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileIconKind } from "../src/utils/fileIcon";
import catalog from "../src/assets/file-icons/catalog.json";

const cases: [string, string][] = [
  ["server.jar", "java"], ["SERVER.WAR", "java"], ["service.ear", "java"],
  ["report.PDF", "pdf"], ["报告.docx", "word"], ["预算.xlsx", "excel"],
  ["介绍.pptx", "powerpoint"], ["计划.xmind", "xmind"],
  ["script.py", "python"], ["index.js", "javascript"], ["index.ts", "typescript"],
  ["view.jsx", "react-javascript"], ["view.tsx", "react-typescript"],
  ["types.d.ts", "typescript-definition"], ["types.d.mts", "typescript-definition"],
  ["main.go", "go"], ["main.rs", "rust"], ["View.swift", "swift"],
  ["Dockerfile", "docker"], ["Dockerfile.production", "docker"],
  ["docker-compose.prod.yaml", "docker"], ["pom.xml", "maven"],
  ["package.json", "npm"], ["Cargo.toml", "cargo"], ["go.mod", "go-package"],
  ["tsconfig.app.json", "tsconfig"], [".gitignore", "git"], [".env.local", "environment"],
  ["logs.tar.zst", "archive"], ["notes.odt", "writer"], ["data.csv", "csv"],
  [".notes.pdf", "pdf"], [".pdf", "file"], ["no-extension", "file"],
  ["unknown.unknown", "file"], ["constructor", "file"], ["__proto__", "file"], ["", "file"],
];
test("specific software, compound extensions and hidden filenames", () => {
  for (const [name, icon] of cases) expect(fileIconKind(name)).toBe(icon);
  expect(fileIconKind("report.pdf", true)).toBe("folder");
});
test("all catalog targets exist and bundled artwork matches its source digest", () => {
  for (const id of [...Object.values(catalog.names), ...Object.values(catalog.extensions), ...catalog.patterns.map(p => p.icon)]) {
    expect(Object.hasOwn(catalog.icons, id)).toBe(true);
  }
  for (const icon of Object.values(catalog.icons)) {
    const hash = (file: string) => createHash("sha256").update(readFileSync(new URL(`../src/assets/file-icons/${file}`, import.meta.url))).digest("hex");
    expect(hash(icon.file)).toBe(icon.sha256);
    if ("light" in icon) expect(hash(icon.light)).toBe(icon.lightSha256);
  }
});

import { cn } from "@/react/lib/utils";
import { fileIconAssets, fileIconKind } from "@/utils/fileIcon";
import "./file-type-icon.css";

const assets = import.meta.glob<string>("../../assets/file-icons/*.{svg,png}", {
  eager: true, query: "?url", import: "default",
});
const assetURL = (file: string) => assets[`../../assets/file-icons/${file}`];

/** Decorative only: the filename remains the row's accessible name. */
export function FileTypeIcon({ name, isDir = false, className }: { name: string; isDir?: boolean; className?: string }) {
  const kind = fileIconKind(name, isDir);
  if (kind === "folder") {
    return (
      <svg viewBox="0 0 24 24" className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" focusable="false">
        <path fill="#4C8DFF" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
      </svg>
    );
  }
  const asset = fileIconAssets[kind];
  return (
    <span className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center", className)} aria-hidden="true">
      <img src={assetURL(asset.light ?? asset.file)} alt="" draggable={false} className={cn("h-full w-full object-contain", asset.light && "file-type-icon-light")} />
      {asset.light && <img src={assetURL(asset.file)} alt="" draggable={false} className="file-type-icon-dark h-full w-full object-contain" />}
    </span>
  );
}

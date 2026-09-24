import { useEffect, useState } from "react";
import type { LocalTextCheck } from "@/api";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/react/components/ui/dialog";

type Props = {
  open: boolean;
  items: LocalTextCheck[];
  onCancel: () => void;
  onUploadRaw: () => void;
  onUploadConvert: (convertPaths: string[]) => void;
};

export function EncodeCheckDialog({
  open,
  items,
  onCancel,
  onUploadRaw,
  onUploadConvert,
}: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setChecked(new Set(items.map((item) => item.path)));
    setExpanded(new Set());
  }, [items]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="w-[min(680px,calc(100%-32px))] max-h-[80vh] overflow-hidden">
        <DialogTitle>检测到非标准 Linux 文本</DialogTitle>
        <DialogDescription>
          以下文件非 UTF-8（无 BOM）+ LF。勾选的文件上传时自动规范为标准格式，未勾选的原样上传。
        </DialogDescription>
        <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
          {items.map((item) => {
            const on = checked.has(item.path);
            const openPreview = expanded.has(item.path);
            return (
              <div key={item.path} className="border-b border-line pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(event) => {
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) next.add(item.path);
                          else next.delete(item.path);
                          return next;
                        });
                      }}
                    />
                    <span className="truncate font-mono text-[13px]">
                      {item.relPath || item.name || item.path}
                    </span>
                  </label>
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px] text-muted">
                    {item.encoding} / {item.lineEnding}
                  </span>
                  <span className="text-xs text-muted">→</span>
                  <span className="rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[11px] text-accent">
                    UTF-8 / LF
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.path)) next.delete(item.path);
                        else next.add(item.path);
                        return next;
                      });
                    }}
                  >
                    {openPreview ? "收起" : "预览"}
                  </Button>
                </div>
                {openPreview ? (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] text-muted">
                        原始（{item.encoding} / {item.lineEnding}）
                      </div>
                      <pre className="max-h-[180px] overflow-auto rounded-surface bg-[#191c21] p-2 font-mono text-xs text-[#e5e7eb] whitespace-pre-wrap break-all">
                        {item.content}
                      </pre>
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] text-muted">转换后（UTF-8 / LF）</div>
                      <pre className="max-h-[180px] overflow-auto rounded-surface bg-[#191c21] p-2 font-mono text-xs text-[#e5e7eb] whitespace-pre-wrap break-all">
                        {item.normalized}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={onUploadRaw}>全部原样上传</Button>
          <Button variant="primary" onClick={() => onUploadConvert(Array.from(checked))}>
            上传（勾选转 UTF-8/LF）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

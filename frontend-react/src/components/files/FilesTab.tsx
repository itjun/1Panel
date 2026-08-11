import { useEffect, useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useApp } from "@/store/app";
import { OnFileDrop, OnFileDropOff } from "@wailsjs/runtime/runtime";
import type { monitor } from "@wailsjs/go/models";
import {
  ChevronRight,
  Folder,
  File as FileIcon,
  ArrowLeft,
  RefreshCw,
  Home,
  Eye,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

// 单次上传任务的状态
interface UploadTask {
  name: string;
  localPath: string;
  status: "uploading" | "ok" | "fail";
  message?: string;
}

// 目录树节点（统一结构，子节点也是 TreeNode）
interface TreeNode {
  path: string;
  name: string;
  loaded: boolean;      // 子目录是否已加载过
  loading: boolean;     // 正在加载子目录
  children: TreeNode[]; // 子目录（只含目录，过滤掉文件）
}

interface Props {
  host: string;
}

export function FilesTab({ host }: Props) {
  const { hosts } = useApp();
  // 当前路径
  const [cwd, setCwd] = useState("/");
  // 当前目录的内容（文件列表用）
  const [entries, setEntries] = useState<monitor.FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 历史栈，用于「后退」
  const [history, setHistory] = useState<string[]>([]);
  // 选中的文件（用于预览）
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 拖拽上传状态
  const [dropActive, setDropActive] = useState(false);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  // 用 ref 拿最新的 cwd/host，避免 OnFileDrop 闭包里捕到旧值
  const cwdRef = useRef(cwd);
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  // ===== 目录树 =====
  const [tree, setTree] = useState<TreeNode>({
    path: "/",
    name: "/",
    loaded: false,
    loading: false,
    children: [],
  });
  // 当前展开的目录路径集合
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));

  // 拉取一个目录的内容（右侧列表用）
  const load = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await api.listDir(host, dir);
        setEntries(list || []);
        setCwd(dir);
      } catch (e) {
        setError(String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [host]
  );

  // 拉取目录树中某个节点的子目录（只保留目录）
  const fetchSubDirs = useCallback(
    async (dir: string): Promise<TreeNode[]> => {
      const list = await api.listDir(host, dir);
      return (list || [])
        .filter((e) => e.isDir)
        .map((e) => ({
          path: e.path,
          name: e.name,
          loaded: false,
          loading: false,
          children: [],
        }));
    },
    [host]
  );

  // 初始加载
  useEffect(() => {
    load("/");
    setTree((t) => ({ ...t, loading: true }));
    fetchSubDirs("/").then((dirs) => {
      setTree((t) => ({ ...t, loaded: true, loading: false, children: dirs }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  // 监听 Wails 文件拖放
  useEffect(() => {
    OnFileDrop((_x: number, _y: number, paths: string[]) => {
      setDropActive(false);
      if (!paths || paths.length === 0) return;
      const targetDir = cwdRef.current;
      const tasks: UploadTask[] = paths.map((p) => ({
        name: p.split("/").pop() || p,
        localPath: p,
        status: "uploading",
      }));
      setUploads((u) => [...tasks, ...u].slice(0, 20));

      // 串行上传（避免并发 sftp 拖垮远程）
      (async () => {
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i];
          try {
            await api.uploadFile(host, t.localPath, targetDir);
            setUploads((u) =>
              u.map((x, idx) =>
                idx === i
                  ? { ...x, status: "ok", message: "已上传到 " + targetDir }
                  : x
              )
            );
          } catch (e) {
            setUploads((u) =>
              u.map((x, idx) =>
                idx === i ? { ...x, status: "fail", message: String(e) } : x
              )
            );
          }
        }
        load(cwdRef.current);
      })();
    }, true);

    return () => {
      OnFileDropOff();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进入子目录：把当前 cwd push 到 history
  const enterDir = (dir: string) => {
    setHistory((h) => [...h, cwd]);
    load(dir);
    setPreview(null);
  };

  // 后退
  const goBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    load(prev);
    setPreview(null);
  };

  // 点击文件条目
  const onItemClick = (e: monitor.FileEntry) => {
    if (e.isDir) {
      enterDir(e.path);
    } else {
      setPreview({ name: e.name, content: "" });
      setPreviewLoading(true);
      api
        .readFileText(host, e.path)
        .then((content) => setPreview({ name: e.name, content }))
        .catch((err) =>
          setPreview({ name: e.name, content: `读取失败: ${err}` })
        )
        .finally(() => setPreviewLoading(false));
    }
  };

  // 展开/折叠目录树节点
  const toggleTreeNode = async (nodePath: string) => {
    const isExpanded = expanded.has(nodePath);
    if (isExpanded) {
      setExpanded((s) => {
        const next = new Set(s);
        next.delete(nodePath);
        return next;
      });
      return;
    }
    // 展开：如果还没加载过子目录，先加载
    setExpanded((s) => new Set(s).add(nodePath));
    setTree((prev) => markTreeLoading(prev, nodePath, true));
    try {
      const dirs = await fetchSubDirs(nodePath);
      setTree((prev) => updateTreeChildren(prev, nodePath, dirs));
    } catch {
      setTree((prev) => updateTreeChildren(prev, nodePath, []));
    }
  };

  // 面包屑
  const breadcrumbs = cwd === "/" ? ["/"] : ["/", ...cwd.split("/").filter(Boolean)];
  const hostInfo = hosts.find((h) => h.name === host);

  return (
    <Card
      className="h-full overflow-hidden"
      // Wails 拖放目标判定：CSS 属性 --wails-drop-target 的值必须为 "drop"
      // OnFileDrop(useDropTarget=true) 时，只有命中此属性的元素才接收文件
      style={{ ["--wails-drop-target" as string]: "drop" } as React.CSSProperties}
      onDragEnter={() => setDropActive(true)}
      onDragLeave={() => setDropActive(false)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Folder className="h-4 w-4" />
          文件浏览
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {hostInfo?.user}@{hostInfo?.hostName} · 只读 · 可拖拽上传
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={history.length === 0}
              onClick={goBack}
            >
              <ArrowLeft className="h-3 w-3" />
              后退
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => load(cwd)}
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </CardTitle>
        {/* 面包屑 */}
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Home className="h-3 w-3" />
          {breadcrumbs.map((part, i) => {
            const path = breadcrumbs.slice(0, i + 1).join("/");
            const target = path === "" ? "/" : path;
            return (
              <span key={i} className="flex items-center gap-1">
                <button
                  className="rounded px-1 hover:bg-accent hover:text-foreground"
                  onClick={() => enterDir(target)}
                >
                  {part === "/" ? "根" : part}
                </button>
                {i < breadcrumbs.length - 1 && (
                  <ChevronRight className="h-3 w-3 opacity-50" />
                )}
              </span>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="flex h-[calc(100%-5rem)] gap-3 overflow-hidden">
        {/* 左侧：目录树 */}
        <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-secondary/30 px-2 py-1.5 text-[10px] font-medium text-muted-foreground">
            目录树
          </div>
          <div className="flex-1 overflow-auto p-1">
            <DirTreeView
              node={tree}
              depth={0}
              expanded={expanded}
              cwd={cwd}
              onToggle={toggleTreeNode}
              onSelect={(p) => load(p)}
            />
          </div>
        </div>

        {/* 中间：文件列表（可拖放） */}
        <div className="relative flex flex-1 flex-col overflow-hidden rounded-lg border border-border">
          {/* 拖拽提示蒙层 */}
          {dropActive && (
            <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
              <UploadCloud className="h-10 w-10 text-primary" />
              <div className="text-sm font-medium text-primary">
                松开以上传到 {cwd}
              </div>
              <div className="text-[10px] text-primary/70">
                支持多文件，将上传到当前目录
              </div>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {loading && entries.length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
                加载中...
              </div>
            )}
            {error && (
              <div className="px-3 py-8 text-center text-[11px] text-destructive">
                {error}
              </div>
            )}
            {!loading && !error && entries.length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
                空目录
              </div>
            )}
            {/* 条目列表 */}
            <table className="w-full text-xs">
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.path}
                    onClick={() => onItemClick(e)}
                    className={cn(
                      "cursor-pointer border-b border-border/30 hover:bg-accent/40",
                      preview?.name === e.name && "bg-accent/60"
                    )}
                  >
                    <td className="px-2 py-1.5" style={{ width: 24 }}>
                      {e.isDir ? (
                        <Folder className="h-3.5 w-3.5 text-primary/70" />
                      ) : (
                        <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </td>
                    <td className="px-1 py-1.5">
                      <span
                        className={cn(
                          "font-mono text-[11px]",
                          e.isDir && "font-medium"
                        )}
                      >
                        {e.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                      {e.isDir ? "-" : formatBytes(e.size)}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      {e.owner}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      {e.modTime}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {!e.isDir && (
                        <Eye className="ml-auto h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右侧：文件预览面板 */}
        {preview && (
          <div className="flex w-[420px] shrink-0 flex-col overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-3 py-1.5">
              <span className="truncate text-[11px] font-medium">
                {preview.name}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setPreview(null)}
              >
                ×
              </Button>
            </div>
            <div className="flex-1 overflow-auto bg-[#0d0d0d] p-3">
              {previewLoading ? (
                <div className="text-[11px] text-muted-foreground">加载中...</div>
              ) : (
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/90">
                  {preview.content || "(空文件)"}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* 上传任务列表 */}
        {uploads.length > 0 && (
          <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-3 py-1.5">
              <span className="text-[11px] font-medium">上传任务</span>
              <button
                onClick={() => setUploads([])}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                清空
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {uploads.map((u, i) => (
                <div key={i} className="border-b border-border/30 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    {u.status === "uploading" && (
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    )}
                    {u.status === "ok" && (
                      <CheckCircle2 className="h-3 w-3 text-success" />
                    )}
                    {u.status === "fail" && (
                      <XCircle className="h-3 w-3 text-destructive" />
                    )}
                    <span className="flex-1 truncate text-[11px]">{u.name}</span>
                  </div>
                  {u.message && (
                    <div
                      className={cn(
                        "mt-0.5 text-[10px]",
                        u.status === "fail"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {u.message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ 目录树递归渲染 ============

interface DirTreeViewProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  cwd: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function DirTreeView({
  node,
  depth,
  expanded,
  cwd,
  onToggle,
  onSelect,
}: DirTreeViewProps) {
  const isExpanded = expanded.has(node.path);
  const isActive = cwd === node.path;

  return (
    <div>
      <div
        className={cn(
          "flex h-6 cursor-pointer items-center gap-1 rounded px-1 text-[11px] hover:bg-accent/50",
          isActive && "bg-primary/15 font-medium text-primary"
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          onToggle(node.path);
          onSelect(node.path);
        }}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-90"
          )}
        />
        <Folder
          className={cn(
            "h-3 w-3 shrink-0",
            isActive ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="truncate">{node.name}</span>
      </div>
      {/* 展开时渲染子目录 */}
      {isExpanded && (
        <div>
          {node.loading && (
            <div
              className="flex items-center gap-1 px-1 py-0.5 text-[10px] text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              加载中...
            </div>
          )}
          {node.children.map((child) => (
            <DirTreeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              cwd={cwd}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
          {!node.loading && node.loaded && node.children.length === 0 && (
            <div
              className="px-1 py-0.5 text-[10px] text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 16 }}
            >
              （空）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ 不可变更新目录树（递归查找目标节点） ============

// 把指定路径的节点标记为 loading 中
function markTreeLoading(root: TreeNode, path: string, loading: boolean): TreeNode {
  if (root.path === path) {
    return { ...root, loading };
  }
  if (root.children.length === 0) return root;
  return {
    ...root,
    children: root.children.map((c) => markTreeLoading(c, path, loading)),
  };
}

// 把指定路径节点的子目录设置进去，并标记 loaded=true、loading=false
function updateTreeChildren(
  root: TreeNode,
  path: string,
  children: TreeNode[]
): TreeNode {
  if (root.path === path) {
    return { ...root, children, loaded: true, loading: false };
  }
  if (root.children.length === 0) return root;
  return {
    ...root,
    children: root.children.map((c) => updateTreeChildren(c, path, children)),
  };
}

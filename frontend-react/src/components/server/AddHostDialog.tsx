import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface AddHostDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// 测试连接的结果状态
type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const EMPTY = { name: "", hostName: "", user: "", password: "" };

export function AddHostDialog({ open, onClose, onSaved }: AddHostDialogProps) {
  const [form, setForm] = useState(EMPTY);
  const [showPwd, setShowPwd] = useState(false);
  const [test, setTest] = useState<TestStatus>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 每次打开重置状态（用新对象，避免 EMPTY 引用比较导致 React 跳过更新）
  useEffect(() => {
    if (open) {
      setForm({ name: "", hostName: "", user: "", password: "" });
      setShowPwd(false);
      setTest({ kind: "idle" });
      setSaveError(null);
      setSaving(false);
    }
  }, [open]);

  // 任一字段变动后，之前的测试结果作废（必须重新测试才能保存）
  useEffect(() => {
    setTest((prev) => (prev.kind === "idle" ? prev : { kind: "idle" }));
    setSaveError(null);
  }, [form.name, form.hostName, form.user, form.password]);

  // 四个必填项齐全 + 测试连接成功后，才允许保存
  const filled = Boolean(
    form.name.trim() &&
      form.hostName.trim() &&
      form.user.trim() &&
      form.password
  );
  const canSave = filled && test.kind === "success" && !saving;

  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // 提交前统一 trim，避免空格导致假通过/假失败
  const payload = () => ({
    name: form.name.trim(),
    hostName: form.hostName.trim(),
    user: form.user.trim(),
    password: form.password, // 密码保留原样，不 trim
  });

  const handleTest = async () => {
    if (!filled) return;
    setTest({ kind: "testing" });
    try {
      const msg = await api.testConnection(payload());
      setTest({ kind: "success", message: msg });
    } catch (e) {
      setTest({ kind: "error", message: String(e) });
    }
  };

  const handleSave = async () => {
    // 硬门禁：四项齐全 + 测试通过，才允许写 ~/.ssh/config
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.addHost(payload());
      onSaved();
      onClose();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="添加主机" width="480px">
      <div className="space-y-4">
        <p className="text-[11px] text-muted-foreground">
          填写 4 项信息后先「测试连接」，验证通过并推送本机公钥后才会保存到{" "}
          <code className="rounded bg-muted px-1">~/.ssh/config</code>，后续免密登录。
        </p>

        {/* 别名 */}
        <Field label="别名" required>
          <Input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="如 web-prod-01"
            autoFocus
          />
        </Field>

        {/* IP / 域名 */}
        <Field label="IP / 域名" required>
          <Input
            value={form.hostName}
            onChange={(e) => update("hostName", e.target.value)}
            placeholder="如 192.168.1.10"
          />
        </Field>

        {/* 用户 */}
        <Field label="登录用户" required>
          <Input
            value={form.user}
            onChange={(e) => update("user", e.target.value)}
            placeholder="如 root 或 ubuntu"
          />
        </Field>

        {/* 密码 */}
        <Field label="密码" required>
          <div className="relative">
            <Input
              type={showPwd ? "text" : "password"}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder="仅用于本次验证与推送公钥，不会保存"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </Field>

        {/* 测试连接按钮 + 结果反馈 */}
        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full gap-1.5 text-xs"
            disabled={!filled || test.kind === "testing"}
            onClick={handleTest}
          >
            {test.kind === "testing" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {test.kind === "testing"
              ? "测试中..."
              : "测试连接"}
          </Button>

          {test.kind === "success" && (
            <div className="flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-1 text-[11px] text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{test.message}</span>
            </div>
          )}
          {test.kind === "error" && (
            <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{test.message}</span>
            </div>
          )}
        </div>

        {/* 保存失败的错误 */}
        {saveError && (
          <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">保存失败：{saveError}</span>
          </div>
        )}

        {/* 操作区 */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>

        {/* 未测试通过时的禁用说明 */}
        {test.kind !== "success" && (
          <p className="text-center text-[10px] text-muted-foreground">
            必须先测试连接通过，才能保存
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={cn("mb-1 block text-xs font-medium text-foreground")}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

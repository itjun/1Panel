/**
 * 主机新建 / 编辑表单（从 entry 抽出并补齐分组、别名、端口可改）。
 *
 * INTEGRATION:
 * - entry 里的创建/编辑改用本文件导出
 */
import { useEffect, useState } from "react";
import { api, type sshconfig } from "@/api";
import { DistroBadge } from "@/react/components/distro-badge";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Notice } from "@/react/components/page";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";

const EDIT_INPUT =
  "h-9 w-full rounded-[4px] border border-[#DFE3E8] bg-white px-3 text-sm text-[#20252B] outline-none focus:border-[#005EEB] disabled:bg-[#f5f7f9] disabled:text-[#687382]";

const CREATE_INPUT = "h-8 rounded-control border border-line px-3";

/** 把端口规范成可写入 Panel 的字符串；空则 22 */
function normalizePort(raw: string): string {
  const trimmed = raw.trim();
  return trimmed || "22";
}

/**
 * 仅更新 Panel JSON 里的端口（updateHost 不带 Port 字段）。
 * 端口无变化时直接返回。
 */
async function applyHostPort(alias: string, port: string): Promise<void> {
  const nextPort = normalizePort(port);
  const state = await api.getPanelState();
  const hosts = state.hosts || [];
  const current = hosts.find((item) => item.alias === alias);
  if (!current) return;
  if (normalizePort(current.port || "") === nextPort) return;
  await api.savePanelState({
    ...state,
    hosts: hosts.map((item) =>
      item.alias === alias ? { ...item, port: nextPort } : item,
    ),
  });
}

/** 分组下拉：空字符串表示未分组 */
function GroupSelect({
  value,
  onChange,
  className,
  disabled,
}: {
  value: string;
  onChange: (groupId: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const session = useSession();
  const groups = [...session.groups].sort((a, b) => a.order - b.order);

  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">未分组</option>
      {groups.map((group) => (
        <option key={group.id} value={group.id}>
          {group.name}
        </option>
      ))}
    </select>
  );
}

/**
 * 新建主机（或分组）。
 * 新建主机时可选分组：先 addHost，再按需 assignHost。
 */
export function HostCreateForm({
  kind,
  onClose,
  onDone,
  defaultGroupId,
}: {
  kind: "host" | "group";
  onClose: () => void;
  onDone: () => void;
  /** 打开时预选的分组；未传则用当前活动分组（若有） */
  defaultGroupId?: string;
}) {
  const session = useSession();
  let preferred = "";
  if (defaultGroupId !== undefined) {
    preferred = defaultGroupId;
  } else if (session.activeGroupId && session.activeGroupId !== UNGROUPED_ID) {
    preferred = session.activeGroupId;
  }

  const [name, setName] = useState("");
  const [hostName, setHostName] = useState("");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [groupId, setGroupId] = useState(preferred);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (kind === "group") {
      if (!name.trim()) {
        setError("分组名不能为空");
        return;
      }
      setBusy(true);
      setError("");
      try {
        await api.upsertGroup({
          id: "",
          name: name.trim(),
          parentId: "",
          order: 0,
          hosts: [],
        });
        onDone();
      } catch (err) {
        setError(formatErr(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    const alias = name.trim();
    const addr = hostName.trim();
    const login = user.trim();
    if (!alias || !addr || !login || !password) {
      setError("别名、地址、用户、密码均不能为空");
      return;
    }

    setBusy(true);
    setError("");
    try {
      // addHost 内部会测连并推公钥
      await api.addHost({
        name: alias,
        hostName: addr,
        user: login,
        password,
        note: note.trim(),
      });
      const gid = groupId.trim();
      if (gid) {
        await api.assignHost(alias, gid);
      }
      onDone();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      {error ? <Notice text={error} /> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input
          className={CREATE_INPUT}
          placeholder={kind === "group" ? "分组名" : "别名"}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        {kind === "host" ? (
          <>
            <input
              className={CREATE_INPUT}
              placeholder="地址"
              value={hostName}
              disabled={busy}
              onChange={(event) => setHostName(event.target.value)}
            />
            <GroupSelect
              className={CREATE_INPUT}
              value={groupId}
              disabled={busy}
              onChange={setGroupId}
            />
            <input
              className={CREATE_INPUT}
              placeholder="用户"
              value={user}
              disabled={busy}
              onChange={(event) => setUser(event.target.value)}
            />
            <input
              className={CREATE_INPUT}
              placeholder="密码"
              type="password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
            <textarea
              className="min-h-[64px] rounded-control border border-line px-3 py-2 text-sm md:col-span-2"
              placeholder="备注（可选）"
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? (kind === "host" ? "连接中…" : "保存中…") : "保存"}
        </Button>
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
      </div>
    </Card>
  );
}

/**
 * 侧栏编辑主机：别名 / 分组 / 端口 / 地址 / 用户 / 密码 / 备注均可改。
 * 「测试并保存」走 updateHost（测连 + 推公钥）；别名用 renameHost，分组用 assignHost，
 * 端口用 getPanelState + savePanelState 补写（updateHost 不带 Port）。
 */
export function HostEditForm({
  host,
  onClose,
  onDone,
}: {
  host: sshconfig.HostConfig;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const session = useSession();
  const [alias, setAlias] = useState(host.name);
  const [hostName, setHostName] = useState(host.hostName);
  const [user, setUser] = useState(host.user);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState(host.note || "");
  const [port, setPort] = useState(normalizePort(host.port || ""));
  const [groupId, setGroupId] = useState(() => session.groupIdOf(host.name));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAlias(host.name);
    setHostName(host.hostName);
    setUser(host.user);
    setNote(host.note || "");
    setPort(normalizePort(host.port || ""));
    setGroupId(session.groupIdOf(host.name));
    setPassword("");
    setError("");
    void api
      .getHostPassword(host.name)
      .then((pwd) => setPassword(pwd || ""))
      .catch(() => {
        /* 预填失败不影响编辑，用户可手动输入 */
      });
  }, [host, session.groupIdOf]);

  async function handleSave() {
    const nextAlias = alias.trim();
    const addr = hostName.trim();
    const login = user.trim();
    if (!nextAlias || !addr || !login || !password) {
      setError("别名、地址、用户、密码不能为空");
      return;
    }

    // 在任何 rename/update 之前记下原分组，避免 rename 后用旧别名查不到
    const prevGroup = session.groupIdOf(host.name);
    const nextGroup = groupId.trim();

    setBusy(true);
    setError("");
    try {
      // 1) 别名变更：先 rename，后续接口都用新别名
      if (nextAlias !== host.name) {
        await api.renameHost(host.name, nextAlias);
      }

      // 2) 测连 + 更新地址/用户/密码/备注
      await api.updateHost({
        name: nextAlias,
        hostName: addr,
        user: login,
        password,
        note: note.trim(),
      });

      // 3) 分组：空字符串 = 未分组
      if (nextGroup !== prevGroup) {
        await api.assignHost(nextAlias, nextGroup);
      }

      // 4) 端口：Panel JSON 单独补写
      await applyHostPort(nextAlias, port);

      await onDone();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4 pt-5">
        <div className="mb-6 flex items-start gap-3">
          <DistroBadge osRelease={session.osRelease[host.name]} />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold leading-tight text-[#20252B]">编辑主机</div>
            <div className="mt-0.5 truncate text-[12px] text-[#687382]">{host.name}</div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-[#687382] hover:bg-black/5"
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error ? (
          <div className="mb-4">
            <Notice text={error} />
          </div>
        ) : null}

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-[#687382]">地址</div>
          <input
            className={EDIT_INPUT}
            placeholder="IP / 域名"
            value={hostName}
            disabled={busy}
            onChange={(event) => setHostName(event.target.value)}
          />
        </section>

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-[#687382]">常规</div>
          <div className="flex flex-col gap-2">
            <input
              className={EDIT_INPUT}
              placeholder="别名"
              value={alias}
              disabled={busy}
              onChange={(event) => setAlias(event.target.value)}
            />
            <GroupSelect
              className={EDIT_INPUT}
              value={groupId}
              disabled={busy}
              onChange={setGroupId}
            />
          </div>
        </section>

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-[#687382]">SSH</div>
          <div className="flex items-center gap-2 text-sm text-[#20252B]">
            <span>端口</span>
            <input
              className="h-9 w-16 rounded-[4px] border border-[#DFE3E8] bg-white px-2 text-center text-sm text-[#20252B] outline-none focus:border-[#005EEB] disabled:bg-[#f5f7f9] disabled:text-[#687382]"
              value={port}
              disabled={busy}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>
        </section>

        <section className="mb-5">
          <div className="mb-2 text-[12px] text-[#687382]">登录</div>
          <div className="flex flex-col gap-2">
            <input
              className={EDIT_INPUT}
              placeholder="用户"
              value={user}
              disabled={busy}
              onChange={(event) => setUser(event.target.value)}
            />
            <input
              className={EDIT_INPUT}
              placeholder="密码"
              type="password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </section>

        <section className="mb-2">
          <div className="mb-2 text-[12px] text-[#687382]">备注</div>
          <textarea
            className="min-h-[88px] w-full resize-y rounded-[4px] border border-[#DFE3E8] bg-white px-3 py-2 text-sm text-[#20252B] outline-none focus:border-[#005EEB] disabled:bg-[#f5f7f9]"
            placeholder="备注"
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </section>
      </div>

      <div className="shrink-0 border-t border-[#DFE3E8] p-4">
        <button
          type="button"
          disabled={busy || !alias.trim() || !hostName.trim() || !user.trim() || !password}
          className="h-10 w-full rounded-[4px] bg-[#005EEB] text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void handleSave()}
        >
          {busy ? "验证并保存…" : "测试并保存"}
        </button>
      </div>
    </div>
  );
}

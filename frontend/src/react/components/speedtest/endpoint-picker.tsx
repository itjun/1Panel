import { useMemo } from "react";
import { Select, type SelectOption } from "@/react/components/ui/select";
import { useSession } from "@/react/state/session";
import { LOCAL_ID } from "./format";

/** 端点选择：首项「本机」，其余为 SSH Config 主机（附所在分组）；可按名称、HostName(IP)、分组搜索 */
export function EndpointPicker({
  value,
  onChange,
  exclude,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  exclude?: string;
  disabled?: boolean;
  label: string;
}) {
  const session = useSession();
  const options = useMemo<SelectOption<string>[]>(() => {
    const groupOf = new Map<string, string>();
    for (const g of session.groups) {
      for (const h of g.hosts || []) if (!groupOf.has(h)) groupOf.set(h, g.name);
    }
    const list: SelectOption<string>[] = [
      { value: LOCAL_ID, label: "本机", keywords: "local localhost 127.0.0.1", disabled: exclude === LOCAL_ID },
    ];
    for (const h of session.hosts) {
      const group = groupOf.get(h.name);
      list.push({
        value: h.name,
        disabled: exclude === h.name,
        keywords: [h.hostName, group].filter(Boolean).join(" "),
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{h.name}</span>
            {group ? <span className="shrink-0 text-xs text-muted">{group}</span> : null}
          </span>
        ),
      });
    }
    return list;
  }, [session.hosts, session.groups, exclude]);

  return (
    <Select
      aria-label={label}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="选择主机"
      filterable
      disabled={disabled}
      className="w-56"
      panelClassName="max-h-80 overflow-auto"
    />
  );
}

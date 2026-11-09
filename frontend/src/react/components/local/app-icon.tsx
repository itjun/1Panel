import { useQuery } from "@tanstack/react-query";
import { AppWindow, Braces, Cog, Coffee, Terminal } from "lucide-react";
import { api } from "@/api";
import { isMacPlatform } from "@/react/lib/platform";

/** 进程可能来自应用内的 Helper；统一取最外层 .app，复用软件列表图标缓存。 */
export function appBundlePath(path: string): string {
  return path.match(/^(.+?\.app)(?:\/|$)/i)?.[1] || "";
}

export function LocalAppIcon({ path = "", runtime = "", isService = false }: {
  path?: string;
  runtime?: string;
  isService?: boolean;
}) {
  const bundle = appBundlePath(path);
  const isEnabled = isMacPlatform() && !!bundle;
  const query = useQuery({
    queryKey: ["local-pkg-icon", bundle],
    queryFn: () => api.localSysPackageIcon(bundle),
    enabled: isEnabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  if (isEnabled && query.data) {
    return <img src={query.data} alt="" aria-hidden className="size-5 shrink-0 object-contain" draggable={false} />;
  }
  const Icon = runtime === "java" ? Coffee : runtime === "javascript" || runtime === "go" ? Braces : runtime === "python" ? Terminal : isService ? Cog : AppWindow;
  return <Icon aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={1.5} />;
}

import type { ComponentProps, ReactNode } from "react";
import { TextFileList, TextPage, TextViewTabs } from "./text-reader";
import "@/react/styles/file-workspace.css";

export const NGINX_VIEWS = [
  { key: "config", label: "配置" },
  { key: "nginx_access", label: "访问日志" },
  { key: "nginx_error", label: "错误日志" },
] as const;
export type NginxView = (typeof NGINX_VIEWS)[number]["key"];

/** 本机与远程只提供数据，外框和操作始终使用同一套组件。 */
export function FileWorkspacePage(props: ComponentProps<typeof TextPage>) {
  return <TextPage {...props} className="file-workspace-page" />;
}

export function NginxViewTabs({ value, onChange }: { value: NginxView; onChange: (value: NginxView) => void }) {
  return <TextViewTabs label="Nginx 内容" items={NGINX_VIEWS} value={value} onChange={onChange} />;
}

export function FileWorkspace({ files, path, onSelect, isLoading, children }: Omit<ComponentProps<typeof TextFileList>, "location"> & { children: ReactNode }) {
  return <div className="file-workspace">
    <TextFileList files={files} path={path} onSelect={onSelect} isLoading={isLoading} />
    {children}
  </div>;
}

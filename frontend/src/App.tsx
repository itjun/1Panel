import { useEffect, useState } from "react";
import { AppProvider, useApp } from "@/store/app";
import { SettingsProvider } from "@/store/settings";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar } from "@/components/layout/TabBar";
import { MainPane } from "@/components/layout/MainPane";
import { TopBar } from "@/components/layout/TopBar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { AddHostDialog } from "@/components/server/AddHostDialog";
import { TooltipProvider } from "@/components/ui/tooltip";

function AppShell() {
  const { refresh } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addHostOpen, setAddHostOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 标签列宽度（可拖拽调整，持久化）
  const [tabColWidth, setTabColWidth] = useState(() => {
    const saved = localStorage.getItem("ipannel.tabColWidth");
    return saved ? parseInt(saved) : 160;
  });

  const updateTabColWidth = (w: number) => {
    setTabColWidth(w);
    localStorage.setItem("ipannel.tabColWidth", String(w));
  };

  // 全局快捷键：Cmd+,  打开设置
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAddHost={() => setAddHostOpen(true)}
        />
        <div className="flex flex-1 overflow-hidden">
          <div
            className="transition-all duration-200 ease-in-out overflow-hidden"
            style={{ width: sidebarOpen ? undefined : 0 }}
          >
            {sidebarOpen && <Sidebar />}
          </div>
          <TabBar width={tabColWidth} onResize={updateTabColWidth} />
          <MainPane />
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <AddHostDialog
        open={addHostOpen}
        onClose={() => setAddHostOpen(false)}
        onSaved={() => {
          void refresh();
        }}
      />
    </>
  );
}

function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsProvider>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </SettingsProvider>
    </TooltipProvider>
  );
}

export default App;

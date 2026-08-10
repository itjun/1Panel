import { useEffect, useState } from "react";
import { AppProvider } from "@/store/app";
import { SettingsProvider } from "@/store/settings";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainPane } from "@/components/layout/MainPane";
import { TopBar } from "@/components/layout/TopBar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { TooltipProvider } from "@/components/ui/tooltip";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    <TooltipProvider delayDuration={300}>
      <SettingsProvider>
        <AppProvider>
          <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
            <TopBar onOpenSettings={() => setSettingsOpen(true)} />
            <div className="flex flex-1 overflow-hidden">
              <Sidebar />
              <MainPane />
            </div>
          </div>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </AppProvider>
      </SettingsProvider>
    </TooltipProvider>
  );
}

export default App;

import { useEffect } from "react";
import { AppProvider, useApp } from "@/store/app";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainPane } from "@/components/layout/MainPane";
import { TopBar } from "@/components/layout/TopBar";
import { TooltipProvider } from "@/components/ui/tooltip";

function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <AppProvider>
        <div className="dark flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <MainPane />
          </div>
        </div>
      </AppProvider>
    </TooltipProvider>
  );
}

export default App;

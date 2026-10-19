import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/react/components/ui/button";
import { NOTIFY_SOURCE, type NotifySource } from "@/react/lib/notify-model";
import { useSession } from "@/react/state/session";

export function NotifyPageHeader({
  title,
  description,
  source,
  children,
}: {
  title: string;
  description: string;
  source?: NotifySource;
  children?: ReactNode;
}) {
  const session = useSession();
  return (
    <header className="notify-page-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="notify-header-actions">
        {children}
        {source ? (
          <Button
            variant="ghost"
            onClick={() =>
              session.setNotifySection(NOTIFY_SOURCE[source].messages)
            }
          >
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            返回消息
          </Button>
        ) : null}
      </div>
    </header>
  );
}

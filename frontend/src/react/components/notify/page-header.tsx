export function NotifyPageHeader({ title }: { title: string }) {
  return (
    <header className="notify-page-header">
      <div className="min-w-0">
        <h1>{title}</h1>
      </div>
    </header>
  );
}

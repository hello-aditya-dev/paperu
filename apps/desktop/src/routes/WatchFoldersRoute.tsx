export function WatchFoldersRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Watch Folders</h1>
      <p className="paperu-workspace__subtitle">Automatic file automation when files appear.</p>
      <p>V1: persisted folder rules via SQLite migration 0006. Non-destructive actions only at 50%. Background monitoring needs Tauri runtime + debounce + loop prevention.</p>
    </section>
  );
}

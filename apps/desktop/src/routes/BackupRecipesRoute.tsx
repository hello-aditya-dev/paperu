export function BackupRecipesRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Local Backup Recipes</h1>
      <p className="paperu-workspace__subtitle">Persistent backup definitions with dry-run.</p>
      <p>V1: create recipe (sources + destination + include/exclude patterns), dry run, run now, verify. Persisted via SQLite migration 0006.</p>
    </section>
  );
}

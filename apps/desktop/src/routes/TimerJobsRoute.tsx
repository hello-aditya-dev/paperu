export function TimerJobsRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Timer Jobs</h1>
      <p className="paperu-workspace__subtitle">Scheduled Paperu operations — one-time, daily, weekly.</p>
      <p>V1: persisted jobs via SQLite migration 0006. Paperu must be open for jobs to run — this is honestly documented, not claimed as background scheduling.</p>
    </section>
  );
}

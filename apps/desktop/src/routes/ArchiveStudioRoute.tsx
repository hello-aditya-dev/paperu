export function ArchiveStudioRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Archive Studio</h1>
      <p className="paperu-workspace__subtitle">Safe ZIP create, list, and extract.</p>
      <p>V1: path-traversal prevention (ZIP Slip), entry validation, suspicious-ratio detection. Needs the <code>zip</code> crate for actual create/extract.</p>
    </section>
  );
}

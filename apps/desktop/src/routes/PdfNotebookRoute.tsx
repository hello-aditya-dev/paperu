export function PdfNotebookRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">PDF Notebook</h1>
      <p className="paperu-workspace__subtitle">Build a PDF notebook with blank, ruled, grid, or dotted pages.</p>
      <p>V1: page templates + validated PDF export arrive next sprint. The architecture reuses pdf-lib.</p>
    </section>
  );
}

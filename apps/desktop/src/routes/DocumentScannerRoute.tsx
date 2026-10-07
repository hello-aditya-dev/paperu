export function DocumentScannerRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Document Scanner</h1>
      <p className="paperu-workspace__subtitle">Turn phone photos of documents into clean PDFs.</p>
      <p>V1: deterministic crop, rotate, brightness/contrast, combine to PDF. No AI document understanding.</p>
    </section>
  );
}

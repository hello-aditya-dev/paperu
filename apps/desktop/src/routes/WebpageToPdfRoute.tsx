export function WebpageToPdfRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Webpage → Clean PDF</h1>
      <p className="paperu-workspace__subtitle">Enter a URL, get a clean printable PDF.</p>
      <p>V1: needs the Tauri HTTP capability + a local HTML-to-PDF engine. Remote content is isolated — never receives Paperu IPC access.</p>
    </section>
  );
}

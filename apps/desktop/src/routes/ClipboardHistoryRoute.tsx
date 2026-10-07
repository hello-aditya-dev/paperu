export function ClipboardHistoryRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Clipboard History</h1>
      <p className="paperu-workspace__subtitle">Opt-in local clipboard history. No uploads.</p>
      <p>V1: capture-current-clipboard + bounded local storage. Background monitoring needs Tauri runtime + security review.</p>
    </section>
  );
}

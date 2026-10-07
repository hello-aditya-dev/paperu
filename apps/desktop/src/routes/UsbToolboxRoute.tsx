export function UsbToolboxRoute(): React.ReactNode {
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">USB / Drive Toolbox</h1>
      <p className="paperu-workspace__subtitle">Copy with checksum verification. Not forensic recovery.</p>
      <p>V1: source/dest selection, copy + verify via SHA-256, mismatch reporting. Needs Tauri runtime for filesystem access.</p>
    </section>
  );
}

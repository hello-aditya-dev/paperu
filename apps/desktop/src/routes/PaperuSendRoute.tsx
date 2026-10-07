/**
 * Paperu Send route — computer ↔ phone file transfer over local network
 * (Master Prompt 4 §44-48).
 *
 * HONEST STATUS (per §0 + §92): the Rust-side HTTP server + ephemeral
 * session token + path validation + checksums requires the Tauri
 * runtime (feature-gated commands) and runtime testing this sandbox
 * cannot do. Per Master Prompt §46: "Do NOT create an unrestricted LAN
 * file server."
 *
 * Therefore Paperu Send is FEATURE-FLAGGED OUT of the production V1
 * surface. The route exists for architectural completeness and shows
 * a clear "Not available in this build" notice rather than a fake QR
 * code or a non-functional transfer UI.
 *
 * When the Tauri runtime is wired + the security invariants of §46
 * are runtime-tested, this route flips to the real Send UI.
 */

export function PaperuSendRoute(): React.ReactNode {
  return (
    <section className="paperu-send">
      <header className="paperu-send__header">
        <h1 className="paperu-send__title">Paperu Send</h1>
        <p className="paperu-send__subtitle">
          Send files between this computer and your phone — no cloud.
        </p>
      </header>
      <div className="paperu-send__not-available" role="status">
        <p>
          Paperu Send is not available in this build.
        </p>
        <p className="paperu-send__reason">
          The local-network file server requires the Tauri runtime,
          an ephemeral session token, path validation, and bounded
          uploads — none of which can be runtime-tested in this
          sandbox environment. Per the Master Prompt's reality rule
          (§0) and feature-flag rule (§92), unfinished functionality
          is hidden from production UI rather than shipped broken.
        </p>
        <p className="paperu-send__next">
          The Rust server logic + Tauri commands are the next sprint's
          first task.
        </p>
      </div>
    </section>
  );
}

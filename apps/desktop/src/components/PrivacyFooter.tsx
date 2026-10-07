/** PrivacyFooter — a sticky footer that states the local-first promise. */

export function PrivacyFooter(): React.ReactNode {
  return (
    <footer className="paperu-shell__footer paperu-footer" role="contentinfo">
      <div className="paperu-footer__inner">
        <span className="paperu-footer__promise">
          <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes
          uploaded
        </span>
        <span className="paperu-footer__name">Paperu</span>
      </div>
    </footer>
  );
}

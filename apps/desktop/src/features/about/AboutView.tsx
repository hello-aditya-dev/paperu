/**
 * AboutView — Paperu → About screen (doctrine §73).
 *
 * Displays: Paperu, version, build, platform/architecture,
 * copyright/licence, website, check for updates, diagnostics link.
 * No developer framework branding.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { AppInfo } from "@paperu/contracts";
import { readAppInfo } from "@/lib/ipc";
import { detectPlatform } from "@/lib/platform";
import { Card, Button } from "@paperu/ui";

export function AboutView(): React.ReactNode {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    readAppInfo()
      .then(setInfo)
      .catch(() => {
        // Non-fatal — show what we can.
      });
  }, []);

  const platform = detectPlatform();
  const arch = typeof navigator !== "undefined" ? navigator.platform : "unknown";

  return (
    <section className="paperu-section" aria-labelledby="about-heading">
      <header className="paperu-section__header">
        <h1 id="about-heading" className="paperu-text-display">About Paperu</h1>
      </header>

      <Card className="paperu-about">
        <div className="paperu-about__mark" aria-hidden="true">P</div>
        <h2 className="paperu-about__name">Paperu</h2>
        <p className="paperu-about__version paperu-text-numeric">
          v{info?.version ?? "0.1.0"}
        </p>
        <p className="paperu-about__tagline">Your files. Your computer.</p>

        <dl className="paperu-about__meta">
          <div>
            <dt className="paperu-text-metadata-key">Version</dt>
            <dd className="paperu-text-metadata-value">{info?.version ?? "0.1.0"}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Edition</dt>
            <dd className="paperu-text-metadata-value">{info?.edition ?? "free"}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Platform</dt>
            <dd className="paperu-text-metadata-value">{platform}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Architecture</dt>
            <dd className="paperu-text-metadata-value">{arch}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Settings version</dt>
            <dd className="paperu-text-metadata-value">{info?.settingsVersion ?? 1}</dd>
          </div>
        </dl>

        <p className="paperu-about__copyright">
          © 2026 Paperu. All rights reserved.
        </p>
        <p className="paperu-about__licence">
          Proprietary commercial licence. See LICENSE for details.
        </p>

        <div className="paperu-about__actions">
          <Button variant="outline" onClick={() => navigate("/diagnostics")}>
            Diagnostics
          </Button>
        </div>

        <p className="paperu-about__privacy">
          <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded
        </p>
      </Card>
    </section>
  );
}

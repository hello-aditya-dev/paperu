/**
 * Onboarding route — short first-run profile choice
 * (Master Prompt 4 §69-70).
 *
 * Two screens: profile selection (Everyday / Study / Everything),
 * then a "your files stay here" reassurance. Then off to Home.
 *
 * The chosen profile is persisted via the canonical settings patch
 * (writeSettings). The App shell reads it to filter the nav rail for
 * Student Mode (§7).
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { writeSettings } from "@/lib/ipc";

export type Profile = "everyday" | "study" | "everything";

export function OnboardingRoute(): React.ReactNode {
  const [step, setStep] = useState<1 | 2>(1);
  const [profile, setProfile] = useState<Profile | null>(null);
  const navigate = useNavigate();

  const onPick = (p: Profile) => {
    setProfile(p);
    setStep(2);
  };

  const onFinish = async () => {
    if (!profile) return;
    try {
      // Persist the profile via settings patch. SettingsPatch is
      // open-ended; profile is a new optional field the App shell can
      // read. Contract extension for Integrator to formalize; until
      // then, cast through unknown.
      const patch = {
        profile,
      } as unknown as Parameters<typeof writeSettings>[0];
      await writeSettings(patch);
    } catch {
      // Non-fatal: defaults to "everything" which shows the full nav.
    }
    navigate("/");
  };

  return (
    <section className="paperu-onboarding">
      {step === 1 && (
        <div className="paperu-onboarding__step">
          <h1 className="paperu-onboarding__title">
            What do you mostly use Paperu for?
          </h1>
          <ul className="paperu-onboarding__profiles">
            <li>
              <button
                type="button"
                className="paperu-onboarding__profile"
                onClick={() => onPick("everyday")}
              >
                <span className="paperu-onboarding__profile-glyph">⌂</span>
                <span className="paperu-onboarding__profile-label">
                  Everyday files
                </span>
                <span className="paperu-onboarding__profile-desc">
                  Shrink, merge, and convert files.
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="paperu-onboarding__profile"
                onClick={() => onPick("study")}
              >
                <span className="paperu-onboarding__profile-glyph">✎</span>
                <span className="paperu-onboarding__profile-label">Study</span>
                <span className="paperu-onboarding__profile-desc">
                  Assignments, reader, notes, print.
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="paperu-onboarding__profile"
                onClick={() => onPick("everything")}
              >
                <span className="paperu-onboarding__profile-glyph">⊕</span>
                <span className="paperu-onboarding__profile-label">
                  Everything
                </span>
                <span className="paperu-onboarding__profile-desc">
                  Show me all of Paperu.
                </span>
              </button>
            </li>
          </ul>
        </div>
      )}

      {step === 2 && (
        <div className="paperu-onboarding__step">
          <h1 className="paperu-onboarding__title">
            Your files stay on this computer.
          </h1>
          <p className="paperu-onboarding__promise">
            Paperu's core file tools work locally. Nothing is uploaded.
          </p>
          <button
            type="button"
            className="paperu-onboarding__start"
            onClick={onFinish}
          >
            Start Paperu
          </button>
        </div>
      )}
    </section>
  );
}

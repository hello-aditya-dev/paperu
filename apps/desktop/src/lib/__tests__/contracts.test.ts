/**
 * Contract tests — assert the JSON fixtures produced by Rust
 * (and authored in @paperu/test-fixtures) parse into the typed
 * TS contracts. This keeps both sides of the IPC boundary honest.
 */

import { describe, expect, it } from "vitest";
import { readContractFixture } from "@paperu/test-fixtures";
import {
  isAppError,
  type AppError,
  type InspectFileResponse,
} from "@paperu/contracts";

describe("inspect file response contract", () => {
  it("matches the canonical JSON fixture", async () => {
    const fixture = await readContractFixture<InspectFileResponse>(
      "inspect-file-response",
    );
    expect(fixture.path).toBe("/home/paperu/fixtures/report.pdf");
    expect(fixture.fileName).toBe("report.pdf");
    expect(fixture.extension).toBe("pdf");
    expect(fixture.kind).toBe("pdf");
    expect(fixture.size.bytes).toBe(1_048_576);
    expect(fixture.size.humanReadable).toBe("1.0 MB");
    expect(fixture.exists).toBe(true);
    expect(fixture.readOnly).toBe(false);
  });
});

describe("app error contract", () => {
  it("matches the canonical JSON fixture and is recognised", async () => {
    const fixture = await readContractFixture<AppError>("app-error");
    expect(isAppError(fixture)).toBe(true);
    expect(fixture.code).toBe("filesystem.file_not_found");
    expect(fixture.category).toBe("filesystem");
    expect(fixture.severity).toBe("error");
    expect(fixture.recoverability).toBe("action_required");
    expect(fixture.message).toBe("Paperu could not find that file.");
  });
});

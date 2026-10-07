/**
 * Regression test for basename finalization (master prompt §9).
 *
 * Architecture guard: `finalizeOutput` must reject a bare basename
 * like `document.pdf` as the source path. The broken pattern that
 * previously shipped in Portal Ready / Print Studio / Batch Studio
 * (`finalizeOutput(file.name, …)`) passed a basename as sourcePath.
 * This test ensures that pattern can NEVER silently return — the
 * guard throws an AppError(InvalidInput) before any IPC call.
 *
 * It also verifies valid native absolute paths (Unix + Windows)
 * still proceed to the IPC layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  finalizeOutput,
  __mockCommand,
  __clearMocks,
  type FinalizeOutputResponse,
} from "@/lib/ipc";
import { ErrorCode, isAppError } from "@paperu/contracts";

function mockFinalizeResponse(): FinalizeOutputResponse {
  return {
    outputPath: "/home/user/paperu/mock-output.pdf",
    output: {
      path: "/home/user/paperu/mock-output.pdf",
      fileName: "mock-output.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      size: { bytes: 1024, humanReadable: "1.0 KB" },
    } as any,
  };
}

describe("finalizeOutput basename guard (regression for §9)", () => {
  beforeEach(() => {
    __clearMocks();
    // Mock the finalize_output command so valid paths succeed.
    __mockCommand("finalize_output", () => mockFinalizeResponse());
  });
  afterEach(() => {
    __clearMocks();
  });

  it("rejects a bare basename (the Portal Ready regression)", async () => {
    // This is exactly what PortalReadyRoute used to do: finalizeOutput(file.name, …)
    await expect(
      finalizeOutput("document.pdf", "-portal-ready", "pdf", new Uint8Array(8)),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
  });

  it("rejects a bare basename with spaces (Print Studio regression)", async () => {
    await expect(
      finalizeOutput("my assignment.pdf", "-print-2-up", "pdf", new Uint8Array(8)),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
  });

  it("rejects an item.fileName basename (Batch Studio regression)", async () => {
    await expect(
      finalizeOutput("photo.jpg", "-fit", "jpg", new Uint8Array(8)),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
  });

  it("rejects an empty source path", async () => {
    await expect(
      finalizeOutput("", "-portal-ready", "pdf", new Uint8Array(8)),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
  });

  it("rejects a non-string source path", async () => {
    // @ts-expect-error — deliberately wrong type to verify the guard.
    await expect(
      finalizeOutput(null, "-x", "pdf", new Uint8Array(8)),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidInput });
  });

  it("accepts a Unix absolute path and proceeds to IPC", async () => {
    const out = await finalizeOutput(
      "/home/user/documents/report.pdf",
      "-portal-ready",
      "pdf",
      new Uint8Array(8),
    );
    expect(out.outputPath).toBe("/home/user/paperu/mock-output.pdf");
  });

  it("accepts a Windows absolute path and proceeds to IPC", async () => {
    const out = await finalizeOutput(
      "C:\\Users\\aditya\\Documents\\report.pdf",
      "-portal-ready",
      "pdf",
      new Uint8Array(8),
    );
    expect(out.outputPath).toBe("/home/user/paperu/mock-output.pdf");
  });

  it("accepts a Windows UNC path and proceeds to IPC", async () => {
    const out = await finalizeOutput(
      "\\\\server\\share\\report.pdf",
      "-portal-ready",
      "pdf",
      new Uint8Array(8),
    );
    expect(out.outputPath).toBe("/home/user/paperu/mock-output.pdf");
  });

  it("accepts a path with Unicode + emoji (Windows path test §23)", async () => {
    const out = await finalizeOutput(
      "/home/user/文档/📸-photo.jpg",
      "-fit",
      "jpg",
      new Uint8Array(8),
    );
    expect(out.outputPath).toBe("/home/user/paperu/mock-output.pdf");
  });

  it("the rejection is a structured AppError, not a raw string", async () => {
    try {
      await finalizeOutput("document.pdf", "-x", "pdf", new Uint8Array(8));
      throw new Error("should have thrown");
    } catch (err) {
      expect(isAppError(err)).toBe(true);
    }
  });
});

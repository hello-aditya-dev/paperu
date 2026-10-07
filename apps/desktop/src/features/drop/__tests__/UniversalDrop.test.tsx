/**
 * Unit tests for the Universal Drop feature using mocked IPC. Verifies
 * that dropped files are inspected through the canonical `inspect_file`
 * contract, classified correctly, and that sensible actions are shown.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { UniversalDrop } from "../UniversalDrop";
import { __mockCommand, __clearMocks } from "@/lib/ipc";
import { CommandName } from "@paperu/contracts";
import type { InspectFileResponse, AppError } from "@paperu/contracts";

// Mock @tauri-apps/api/event listen (used for native drag-drop). In tests
// we exercise the HTML drop fallback instead, so listen is a no-op.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock @tauri-apps/plugin-dialog open; tests that need the picker pass
// their own mock return value via mockDialogOpen.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

const samplePdf: InspectFileResponse = {
  path: "/home/paperu/report.pdf",
  fileName: "report.pdf",
  fileStem: "report",
  extension: "pdf",
  kind: "pdf",
  mimeType: "application/pdf",
  size: { bytes: 7_340_032, humanReadable: "7.0 MB" },
  readOnly: false,
  inSyncedFolder: false,
  exists: true,
};

const sampleImage: InspectFileResponse = {
  path: "/home/paperu/photo.jpg",
  fileName: "photo.jpg",
  fileStem: "photo",
  extension: "jpg",
  kind: "image",
  mimeType: "image/jpeg",
  size: { bytes: 632_978, humanReadable: "618.1 KB" },
  readOnly: false,
  inSyncedFolder: false,
  exists: true,
};

const notFoundError: AppError = {
  code: "filesystem.file_not_found",
  category: "filesystem",
  severity: "error",
  recoverability: "action_required",
  message: "Paperu could not find that file.",
};

function mockInspectFile(
  fn: (args: Record<string, unknown> | undefined) => unknown,
): void {
  __mockCommand(CommandName.InspectFile, fn);
}

function dropFiles(paths: string[]): void {
  const dropzone = screen.getByRole("region", {
    name: /drop files here or choose files/i,
  });
  const files = paths.map((p) => ({ path: p }));
  fireEvent.drop(dropzone, {
    dataTransfer: { files },
  });
}

describe("UniversalDrop", () => {
  beforeEach(() => {
    __clearMocks();
  });

  it("renders the heading and privacy promise before any file", () => {
    render(<UniversalDrop />);
    expect(screen.getByText("What do you need to do?")).toBeInTheDocument();
    expect(
      screen.getAllByText(/0 bytes uploaded/i).length,
    ).toBeGreaterThan(0);
  });

  it("inspects a dropped PDF through the canonical contract and shows real metadata", async () => {
    mockInspectFile(() => samplePdf);
    render(<UniversalDrop />);
    dropFiles(["/home/paperu/report.pdf"]);

    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
    expect(screen.getByText("7.0 MB")).toBeInTheDocument();
    // The kind label "PDF" is rendered in a span with a specific class.
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("shows a PDF-fit action suggestion for a dropped PDF", async () => {
    mockInspectFile(() => samplePdf);
    render(<UniversalDrop />);
    dropFiles(["/home/paperu/report.pdf"]);

    await waitFor(() => {
      expect(screen.getByText(/Make PDF fit/i)).toBeInTheDocument();
    });
  });

  it("shows an image-fit action suggestion for a dropped image", async () => {
    mockInspectFile(() => sampleImage);
    render(<UniversalDrop />);
    dropFiles(["/home/paperu/photo.jpg"]);

    await waitFor(() => {
      expect(screen.getByText(/Make image fit/i)).toBeInTheDocument();
    });
  });

  it("shows a merge suggestion when two PDFs are dropped", async () => {
    const second: InspectFileResponse = {
      ...samplePdf,
      path: "/home/paperu/second.pdf",
      fileName: "second.pdf",
    };
    const responses = new Map([
      ["/home/paperu/report.pdf", samplePdf],
      ["/home/paperu/second.pdf", second],
    ]);
    mockInspectFile((args) => {
      const req = (args as { request?: { path?: string } })?.request;
      const p = req?.path ?? "";
      return responses.get(p) ?? samplePdf;
    });
    render(<UniversalDrop />);
    dropFiles(["/home/paperu/report.pdf", "/home/paperu/second.pdf"]);

    await waitFor(() => {
      expect(screen.getByText(/Merge 2 PDFs/i)).toBeInTheDocument();
    });
  });

  it("handles inspection failure gracefully and keeps other files", async () => {
    const responses = new Map([
      ["/home/paperu/missing.pdf", "error"],
      ["/home/paperu/report.pdf", samplePdf],
    ]);
    mockInspectFile((args) => {
      const req = (args as { request?: { path?: string } })?.request;
      const p = req?.path ?? "";
      if (responses.get(p) === "error") throw notFoundError;
      return samplePdf;
    });
    render(<UniversalDrop />);
    dropFiles(["/home/paperu/missing.pdf", "/home/paperu/report.pdf"]);

    await waitFor(() => {
      expect(screen.getByText(notFoundError.message)).toBeInTheDocument();
    });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("allows removing a staged file", async () => {
    mockInspectFile(() => samplePdf);
    render(<UniversalDrop />);
    dropFiles(["/home/paperu/report.pdf"]);

    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Remove report\.pdf/));
    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
  });

  it("does not fabricate metadata — shows inspecting state before results resolve", async () => {
    // The inspect mock never resolves in this test, so the UI must show
    // the "Inspecting…" state indefinitely without fabricating any size
    // or kind metadata.
    mockInspectFile(() => new Promise<InspectFileResponse>(() => {}));

    render(<UniversalDrop />);
    await act(async () => {
      dropFiles(["/home/paperu/report.pdf"]);
      await new Promise((r) => setTimeout(r, 50));
    });

    // "Inspecting…" appears in the staged file list (and possibly the
    // dropzone hint while busy). The key assertion: no fabricated size.
    expect(screen.getAllByText("Inspecting…").length).toBeGreaterThan(0);
    expect(screen.queryByText("7.0 MB")).not.toBeInTheDocument();
  });
});

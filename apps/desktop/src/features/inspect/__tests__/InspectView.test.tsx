/**
 * Unit tests for the inspect feature using mocked IPC. Verifies the
 * UI correctly renders real metadata returned by the (mocked) Rust
 * layer and shows structured errors on failure.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InspectView } from "../InspectView";
import { __mockCommand, __clearMocks } from "@/lib/ipc";
import { CommandName } from "@paperu/contracts";
import type { InspectFileResponse, AppError } from "@paperu/contracts";

const sampleResponse: InspectFileResponse = {
  path: "/home/paperu/fixtures/report.pdf",
  fileName: "report.pdf",
  fileStem: "report",
  extension: "pdf",
  kind: "pdf",
  mimeType: "application/pdf",
  size: { bytes: 1_048_576, humanReadable: "1.0 MB" },
  modifiedAt: "2026-01-15T09:30:00Z",
  createdAt: "2026-01-10T14:00:00Z",
  accessedAt: "2026-01-15T09:30:00Z",
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
  detail: "The path no longer exists.",
  technical: "std::fs::metadata returned NotFound",
};

function mockAppContext(): void {
  __mockCommand(CommandName.ReadAppInfo, () => ({
    name: "Paperu",
    version: "0.1.0",
    edition: "free",
    settingsVersion: 1,
  }));
  __mockCommand(CommandName.ReadSettings, () => ({
    version: 1,
    theme: "system",
    defaultConflictStrategy: "rename",
    defaultOutputDir: null,
    recentFilesLimit: 25,
    updatePreference: "notify",
    reducedMotion: false,
    allowDiagnostics: false,
  }));
}

function dropFile(path: string): void {
  const dropzone = screen.getByRole("region", {
    name: /drop a file here or choose one/i,
  });
  fireEvent.drop(dropzone, {
    dataTransfer: { files: [{ path }] },
  });
}

describe("InspectView", () => {
  beforeEach(() => {
    __clearMocks();
    mockAppContext();
  });

  it("renders the placeholder and privacy promise before any file", () => {
    render(<InspectView />);
    expect(screen.getByText(/results appear here/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/0 bytes uploaded/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders real metadata after a successful inspect", async () => {
    __mockCommand(CommandName.InspectFile, () => sampleResponse);
    render(<InspectView />);
    dropFile("/home/paperu/fixtures/report.pdf");

    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
    expect(screen.getByText(/1,048,576 bytes/)).toBeInTheDocument();
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    expect(screen.getByText(/source file untouched/i)).toBeInTheDocument();
  });

  it("renders a structured error when inspect fails", async () => {
    __mockCommand(CommandName.InspectFile, () => {
      throw notFoundError;
    });
    render(<InspectView />);
    dropFile("/home/paperu/fixtures/missing.pdf");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(notFoundError.message)).toBeInTheDocument();
    expect(screen.getByText(notFoundError.code)).toBeInTheDocument();
  });
});

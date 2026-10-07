/**
 * Command Center tests (Master Prompt 3 §90).
 *
 * Covers:
 *   - empty query
 *   - exact label
 *   - alias
 *   - prefix
 *   - partial
 *   - case-insensitive
 *   - whitespace
 *   - no result
 *   - multiple ranked results
 *   - keyboard navigation (arrows, enter, escape)
 *   - recent item
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandCenter } from "../CommandCenter";
import { useRecentFiles } from "@/lib/recent-files";
import { __clearMocks } from "@/lib/ipc";

// Reset recent-files store between tests.
function resetRecent() {
  useRecentFiles.setState({ files: [] });
}

beforeEach(() => {
  resetRecent();
  __clearMocks();
});

afterEach(() => {
  cleanup();
  resetRecent();
});

describe("CommandCenter — empty query", () => {
  it("renders the panel with the search input focused", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Search Paperu commands");
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("shows the TOOLS section by default", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("TOOLS")).toBeTruthy();
  });
});

describe("CommandCenter — exact label", () => {
  it("ranks an exact label match above all others", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Merge PDFs" } });
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent?.includes("Merge PDFs")).toBe(true);
  });
});

describe("CommandCenter — alias", () => {
  it("matches via alias (jpg to pdf)", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "jpg to pdf" } });
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent?.includes("Images")).toBe(true);
  });
});

describe("CommandCenter — prefix", () => {
  it("matches a prefix of the label", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "make" } });
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].textContent?.includes("PDF")).toBe(true);
  });
});

describe("CommandCenter — partial", () => {
  it("matches a substring of the label or alias", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sign" } });
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent?.toLowerCase()).toContain("sign");
  });
});

describe("CommandCenter — case-insensitive + whitespace", () => {
  it("matches regardless of case and surrounding whitespace", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   sPlIt   " } });
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent?.toLowerCase()).toContain("split");
  });
});

describe("CommandCenter — no result", () => {
  it("shows the empty state when nothing matches", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzznothingmatcheszzz" } });
    expect(screen.getByText(/No matches for/)).toBeTruthy();
  });
});

describe("CommandCenter — multiple ranked results", () => {
  it("returns multiple results for 'pdf' and ranks pdf-fit first", () => {
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pdf" } });
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0].textContent?.toLowerCase()).toContain("make");
  });
});

describe("CommandCenter — keyboard navigation", () => {
  it("arrow down moves active, enter selects, escape closes", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandCenter onNavigate={onNavigate} onClose={onClose} />);
    const input = screen.getByLabelText(
      "Search Paperu commands",
    ) as HTMLInputElement;

    let rows = screen.getAllByRole("option");
    expect(rows[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    rows = screen.getAllByRole("option");
    expect(rows[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const routeArg = onNavigate.mock.calls[0][0] as string;
    expect(typeof routeArg).toBe("string");
    expect(routeArg.startsWith("/")).toBe(true);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CommandCenter — recent item", () => {
  it("shows RECENT FILES section when recent files exist", () => {
    useRecentFiles.getState().add({
      path: "/tmp/test.pdf",
      fileName: "test.pdf",
      kind: "pdf",
      humanReadableSize: "1.0 KB",
      operation: "Made PDF fit",
      timestamp: Date.now(),
    });
    render(<CommandCenter onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("RECENT FILES")).toBeTruthy();
    expect(screen.getByText("test.pdf")).toBeTruthy();
  });

  it("navigates to inspect when a recent file is clicked", () => {
    const onNavigate = vi.fn();
    useRecentFiles.getState().add({
      path: "/tmp/foo.pdf",
      fileName: "foo.pdf",
      kind: "pdf",
      humanReadableSize: "1.0 KB",
      operation: "Signed",
      timestamp: Date.now(),
    });
    render(<CommandCenter onNavigate={onNavigate} onClose={vi.fn()} />);
    const fileRow = screen.getByText("foo.pdf").closest("li");
    expect(fileRow).toBeTruthy();
    fireEvent.click(fileRow!);
    expect(onNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/inspect?path="),
    );
  });
});

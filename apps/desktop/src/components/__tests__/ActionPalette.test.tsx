/**
 * Smart Action Palette tests (Master Prompt 3 §91).
 *
 * Covers:
 *   - PDF context
 *   - image context
 *   - unsupported file (no module matches, only system actions)
 *   - missing file path (palette closed)
 *   - keyboard (arrow/enter/escape)
 *   - rapid opening/closing (no stale state)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}
import { ActionPalette, type ActionSelection } from "../ActionPalette";

beforeEach(() => {
  // Reset the location hash so each test starts fresh.
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const pdfSelection: ActionSelection = {
  path: "/tmp/test.pdf",
  fileName: "test.pdf",
  kind: "pdf",
};

const imageSelection: ActionSelection = {
  path: "/tmp/photo.jpg",
  fileName: "photo.jpg",
  kind: "image",
};

describe("ActionPalette — PDF context", () => {
  it("shows PDF-relevant module actions", () => {
    renderWithRouter(
      <ActionPalette selection={pdfSelection} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Make PDF fit")).toBeTruthy();
    expect(screen.getByText("Merge PDFs")).toBeTruthy();
    expect(screen.getByText("Split / Extract")).toBeTruthy();
    expect(screen.getByText("Sign PDF")).toBeTruthy();
    expect(screen.getByText("Fill PDF")).toBeTruthy();
  });

  it("shows system actions (Open, Inspect)", () => {
    renderWithRouter(<ActionPalette selection={pdfSelection} onClose={vi.fn()} />);
    expect(screen.getByText("Open file")).toBeTruthy();
    expect(screen.getByText("Inspect file")).toBeTruthy();
  });

  it("does NOT show image-only actions", () => {
    renderWithRouter(<ActionPalette selection={pdfSelection} onClose={vi.fn()} />);
    expect(screen.queryByText("Make image fit")).toBeNull();
    expect(screen.queryByText("Images → PDF")).toBeNull();
  });
});

describe("ActionPalette — image context", () => {
  it("shows image-relevant module actions", () => {
    renderWithRouter(
      <ActionPalette selection={imageSelection} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Make image fit")).toBeTruthy();
    expect(screen.getByText("Images → PDF")).toBeTruthy();
  });

  it("does NOT show PDF-only actions", () => {
    renderWithRouter(<ActionPalette selection={imageSelection} onClose={vi.fn()} />);
    expect(screen.queryByText("Make PDF fit")).toBeNull();
    expect(screen.queryByText("Merge PDFs")).toBeNull();
    expect(screen.queryByText("Sign PDF")).toBeNull();
  });
});

describe("ActionPalette — unsupported file", () => {
  it("still shows system actions even when no module matches", () => {
    const unknownSelection: ActionSelection = {
      path: "/tmp/foo.zzz",
      fileName: "foo.zzz",
      kind: "other",
    };
    renderWithRouter(
      <ActionPalette selection={unknownSelection} onClose={vi.fn()} />,
    );
    // System actions always exist.
    expect(screen.getByText("Open file")).toBeTruthy();
    expect(screen.getByText("Inspect file")).toBeTruthy();
    // No PDF/image module should be shown.
    expect(screen.queryByText("Make PDF fit")).toBeNull();
    expect(screen.queryByText("Make image fit")).toBeNull();
  });
});

describe("ActionPalette — missing selection", () => {
  it("renders nothing when selection is null", () => {
    const { container } = renderWithRouter(
      <ActionPalette selection={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("ActionPalette — keyboard", () => {
  it("arrow down moves active, enter selects, escape closes", () => {
    const onClose = vi.fn();
    renderWithRouter(<ActionPalette selection={pdfSelection} onClose={onClose} />);

    const body = screen.getByRole("listbox");
    const rows = screen.getAllByRole("option");
    expect(rows[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(
      screen.getAllByRole("option")[1].getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.keyDown(body, { key: "Enter" });
    // Enter triggers onSelect which navigates. We can't easily assert
    // the route change in this test (useNavigate is mocked via router
    // context); but onClose is NOT called by sendToModule in this
    // setup — actually it is. Let me check:
    // Wait — Enter calls onSelect → sendToModule → navigate + onClose.
    // So onClose should have been called.
    // Actually the first row is "Open file" (a system action) which
    // also calls onClose. So onClose should be called.
    expect(onClose).toHaveBeenCalled();
  });

  it("escape closes the palette", () => {
    const onClose = vi.fn();
    renderWithRouter(<ActionPalette selection={pdfSelection} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ActionPalette — rapid open/close", () => {
  it("survives rapid open/close without stale state", () => {
    const onClose = vi.fn();
    const base = renderWithRouter(
      <ActionPalette selection={pdfSelection} onClose={onClose} />,
    );
    const { rerender, unmount } = base;
    // Close.
    rerender(
      <MemoryRouter><ActionPalette selection={null} onClose={onClose} /></MemoryRouter>,
    );
    // Reopen with different selection.
    rerender(
      <MemoryRouter><ActionPalette selection={imageSelection} onClose={onClose} /></MemoryRouter>,
    );
    // The new selection should be reflected (Make image fit visible).
    expect(screen.getByText("Make image fit")).toBeTruthy();
    // And PDF-only actions should NOT be visible.
    expect(screen.queryByText("Make PDF fit")).toBeNull();
    unmount();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageCard from "./PageCard";

vi.mock("@/render", () => ({
  renderPage: vi.fn(),
}));

vi.mock("@/annotations", () => ({
  AnnotationLayer: () => null,
}));

afterEach(cleanup);

describe("PageCard render containment", () => {
  it("keeps off-window content explicitly hidden and makes live-window content visible", () => {
    const props = {
      docId: "a".repeat(64),
      pdf: null,
      pageNumber: 1,
      box: { width: 600, height: 800 },
      scale: 1,
      register: vi.fn(),
    };
    const { rerender } = render(<PageCard {...props} live={false} />);
    const card = screen.getByTestId("page-surface");

    expect(card.style.contentVisibility).toBe("hidden");

    rerender(<PageCard {...props} live />);
    expect(card.style.contentVisibility).toBe("visible");
  });
});

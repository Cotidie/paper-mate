import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PageIndicator from "./PageIndicator";

afterEach(cleanup);

describe("PageIndicator", () => {
  it("renders the current page in a chip plus the total", () => {
    render(<PageIndicator currentPage={5} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId("page-indicator-current").textContent).toBe("5");
    expect(screen.getByTestId("page-indicator").textContent).toContain("of 41");
  });

  it("announces the full page position to assistive tech (polite live region)", () => {
    render(<PageIndicator currentPage={5} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe("Page 5 of 41");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("fires onPrev / onNext from the caret buttons", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<PageIndicator currentPage={5} pageCount={41} onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByLabelText("Previous page"));
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables Previous on the first page", () => {
    render(<PageIndicator currentPage={1} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect((screen.getByLabelText("Previous page") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Next page") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Next on the last page", () => {
    render(<PageIndicator currentPage={41} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect((screen.getByLabelText("Next page") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Previous page") as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses real, keyboard-reachable buttons", () => {
    render(<PageIndicator currentPage={5} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByLabelText("Previous page").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Next page").tagName).toBe("BUTTON");
  });
});

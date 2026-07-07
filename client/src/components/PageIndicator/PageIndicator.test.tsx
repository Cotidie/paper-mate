import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PageIndicator from "./PageIndicator";

afterEach(cleanup);

const noop = () => {};

describe("PageIndicator", () => {
  it("renders the current page in the chip plus the total", () => {
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} onJump={vi.fn()} />,
    );
    expect((screen.getByTestId("page-indicator-current") as HTMLInputElement).value).toBe("5");
    expect(screen.getByTestId("page-indicator").textContent).toContain("of 41");
  });

  it("announces the full page position to assistive tech (polite live region)", () => {
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} onJump={vi.fn()} />,
    );
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe("Page 5 of 41");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("fires onPrev / onNext from the caret buttons", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={onPrev} onNext={onNext} onJump={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Previous page"));
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables Previous on the first page", () => {
    render(
      <PageIndicator currentPage={1} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} onJump={vi.fn()} />,
    );
    expect((screen.getByLabelText("Previous page") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Next page") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Next on the last page", () => {
    render(
      <PageIndicator currentPage={41} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} onJump={vi.fn()} />,
    );
    expect((screen.getByLabelText("Next page") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Previous page") as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses real, keyboard-reachable buttons", () => {
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={vi.fn()} onNext={vi.fn()} onJump={vi.fn()} />,
    );
    expect(screen.getByLabelText("Previous page").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Next page").tagName).toBe("BUTTON");
  });

  it("jumps to a typed page on Enter (clamped, digits only)", () => {
    const onJump = vi.fn();
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={noop} onNext={noop} onJump={onJump} />,
    );
    const input = screen.getByTestId("page-indicator-current") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2a0" } }); // non-digits stripped -> "20"
    expect(input.value).toBe("20");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onJump).toHaveBeenCalledWith(20);
  });

  it("clamps an over-the-end typed page to the last page", () => {
    const onJump = vi.fn();
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={noop} onNext={noop} onJump={onJump} />,
    );
    const input = screen.getByTestId("page-indicator-current") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onJump).toHaveBeenCalledWith(41);
  });

  it("commits the typed page on blur", () => {
    const onJump = vi.fn();
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={noop} onNext={noop} onJump={onJump} />,
    );
    const input = screen.getByTestId("page-indicator-current") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.blur(input);
    expect(onJump).toHaveBeenCalledWith(12);
  });

  it("does not jump when the typed page equals the current page", () => {
    const onJump = vi.fn();
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={noop} onNext={noop} onJump={onJump} />,
    );
    const input = screen.getByTestId("page-indicator-current") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onJump).not.toHaveBeenCalled();
  });

  it("abandons the draft on Escape and reverts to the current page", () => {
    const onJump = vi.fn();
    render(
      <PageIndicator currentPage={5} pageCount={41} onPrev={noop} onNext={noop} onJump={onJump} />,
    );
    const input = screen.getByTestId("page-indicator-current") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onJump).not.toHaveBeenCalled();
    expect(input.value).toBe("5");
  });
});

import "./App.css";

/**
 * S1 reader frame (empty). Renders the three chrome zones only — top-bar,
 * reader-backdrop canvas region, and a collapsed tool-rail placeholder — all
 * from DESIGN.md tokens. No PDF, no tools, no bank are wired in this story
 * (1.1). Chrome is laid out as overlays so it never reflows the canvas (NFR-1).
 */
export default function App() {
  return (
    <div className="app">
      <header className="top-bar" role="banner">
        <span className="top-bar__title">Paper Mate</span>
        <div className="top-bar__actions">
          {/* Focusable placeholders — behavior wired in later stories
              (ToC 1.7, Bank 3.6). Present now so chrome shows the focus ring. */}
          <button type="button" className="pill">
            ToC
          </button>
          <button type="button" className="pill">
            Bank
          </button>
        </div>
      </header>

      <main className="stage" role="main">
        <div className="reader-backdrop" data-testid="reader-backdrop" aria-label="PDF canvas region" />
        <aside className="tool-rail" data-testid="tool-rail" aria-label="Tools (collapsed)">
          {/* Collapsed placeholder. Tool buttons arrive in Epic 2. */}
        </aside>
      </main>
    </div>
  );
}

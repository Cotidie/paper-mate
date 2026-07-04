import { createBrowserRouter } from "react-router";
import LibraryPage from "@/library/LibraryPage";
import ReaderPage from "@/reader/ReaderPage";

/**
 * The app's front door (Story 6.1, AD-L3): library/data-mode router (NOT
 * framework mode: no loaders/actions/SSR, AD-2), exactly two routes. `/` is
 * the Library home; `/reader/:docId` is the existing reader, now loading its
 * document from the route param instead of an upload result.
 */
export const router = createBrowserRouter([
  { path: "/", element: <LibraryPage /> },
  { path: "/reader/:docId", element: <ReaderPage /> },
]);

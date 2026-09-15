import type { MetadataRoute } from "next";

/**
 * Web app manifest — what Android and Chrome read when the workspace is
 * installed to a home screen.
 *
 * `name` is the full product; `short_name` is what fits under an icon, so it
 * stays two words. Both used to fall back to the page <title>, which is why an
 * installed shortcut read "Zettaz · Operations".
 *
 * `display: standalone` drops the browser chrome, which matters on the tablets
 * used at the dock: the address bar is dead space and an accidental swipe on it
 * navigates away from a boarding list.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zettaz Tours & Charters",
    short_name: "Zettaz Tours",
    description:
      "Reservations, dispatch and boarding for tour operators — one workspace from the desk to the dock.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#11343B",
    theme_color: "#11343B",
    categories: ["business", "productivity", "travel"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Maskable: Android crops to its own shape, and the mark is inset far
      // enough that a circular crop keeps the whole ring.
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

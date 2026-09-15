import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * The URL a shared link resolves against. Open Graph requires absolute URLs, so
 * without this a pasted link renders with no image at all.
 */
const origin = (
  process.env.WEB_ORIGIN ??
  process.env.NEXT_PUBLIC_WEB_ORIGIN ??
  "https://tours.zettaz.com"
).replace(/\/$/, "");

const title = "Zettaz Tours & Charters";
const description =
  "Reservations, dispatch and boarding for tour operators — one workspace from the desk to the dock.";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: { default: title, template: `%s · ${title}` },
  description,
  applicationName: title,
  // The workspace is private; a shared link must still preview properly in a
  // chat app, but it should never appear in a search index.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    // iOS ignores SVG here — an SVG-only icon is why Add to Home Screen
    // produced a blank grey tile with a letter in it.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // What iOS writes under the home-screen icon. Kept short: the label is
    // truncated after roughly twelve characters.
    title: "Zettaz Tours",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: title,
    title,
    description,
    url: origin,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Zettaz Tours & Charters",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
  },
  formatDetection: { telephone: false, date: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#11343B",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Zettaz · Operations",
  description: "Tenant administration and reservations workspace",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

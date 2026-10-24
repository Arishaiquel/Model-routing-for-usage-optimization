import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuotaPilot AI",
  description: "Local Codex allowances and coding tasks",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

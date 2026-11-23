import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-600-italic.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./globals.css";


export const metadata: Metadata = { title: "Leafmark", description: "Read the passage behind every answer." };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Card trial CSV editor",
  description: "Edit Trials, positions, and card numbers in a CSV and download the result.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Archivo_Black, Rajdhani } from "next/font/google";
import "./globals.css";

const displayFont = Archivo_Black({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const bodyFont = Rajdhani({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Record Catalog",
  description: "Modern vinyl collection catalog",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

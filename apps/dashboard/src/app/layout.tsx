import type { Metadata } from "next";
import { Funnel_Sans, Funnel_Display, Martian_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const funnelSans = Funnel_Sans({
  variable: "--font-funnel-sans",
  subsets: ["latin"],
  display: "swap",
});

const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
  display: "swap",
});

const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
  display: "swap",
  // Trim the variable axis range — we don't need ultralight or extra-wide.
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AgentGuard — secure execution for AI agents",
  description:
    "Drop in an API key. Your agent transacts on-chain with policy enforcement, anomaly detection, and one-click human escalation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${funnelSans.variable} ${funnelDisplay.variable} ${martianMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

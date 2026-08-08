import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";

import { Providers } from "./providers";
import { wagmiConfig } from "@/lib/wagmi";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const DESCRIPTION =
  "Match anonymously. Commit economically. Meet in person. An AI matchmaking agent, x402 payment gating, and Monad settlement.";

export const metadata: Metadata = {
  // Without this, Next cannot build absolute OG URLs and social cards fall back
  // to a bare link with no image.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://blindluv-app.vercel.app"),
  title: "BlindLuv — Autonomous Privacy Dating Agent on Monad",
  description: DESCRIPTION,
  openGraph: {
    title: "BlindLuv — Anonymous until both of you commit",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BlindLuv — Anonymous until both of you commit",
    description: DESCRIPTION,
  },
};

// Next 16 moved themeColor out of `metadata` into its own `viewport` export.
export const viewport: Viewport = {
  themeColor: "#FFF6F3",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * Rehydrate wagmi on the server from the connection cookie. Without this the
   * first paint always renders the signed-out screen and then swaps — a
   * connected user would watch the whole flow flash past on every load.
   */
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get("cookie"));

  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${plexMono.variable} ${inter.variable}`}>
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/structure.css";
import "./styles/app.css";
import "./styles/auth.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The editorial display voice: serif headlines at readable weights, roman and
// italic. Replaces the retired dot-matrix display font.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const title = "RoleAtlas — Find work that fits your life";
  const description = "A transparent, eligibility-aware workspace for discovering jobs, managing searches, and keeping applications moving.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

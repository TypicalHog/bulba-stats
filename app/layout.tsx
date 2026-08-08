import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/ui/nav";
import { SiteFooter } from "@/components/ui/footer";

/**
 * Fira Sans for UI, Fira Code for every number and identifier — a trading
 * readout wants monospace digits that line up in a column.
 */
const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BulbaStats — BulbaStore market analytics",
    template: "%s · BulbaStats",
  },
  description:
    "Deep analytics for the BulbaStore Minecraft item exchange: market volume, order-book liquidity, per-item price history, per-player P&L and treasury flows.",
  applicationName: "BulbaStats",
};

export const viewport: Viewport = {
  themeColor: "#0B0F14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable} h-full`}
    >
      <body className="flex min-h-full flex-col bg-bg text-ink antialiased">
        <SiteNav />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

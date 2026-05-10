import type { Metadata } from "next";

import { Plus_Jakarta_Sans, Spline_Sans_Mono, Fraunces } from "next/font/google";
import { CopilotKitProviderShell } from "@/components/copilot/CopilotKitProviderShell";
import "./globals.css";
// v2 owns its own stylesheet. Do NOT import @copilotkit/react-ui/styles.css —
// v1's .copilotKitButton / .copilotKitSidebar / .copilotKitWindow rules
// collide with v2's same-name selectors (different DOM, different positioning)
// and break the sidebar layout when both are loaded.
import "@copilotkit/react-core/v2/styles.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});

const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: "AG-UI Canvas | CopilotKit Hackathon Starter",
  description:
    "Hackathon starter kit: CopilotKit canvas + threads drawer + Deep Agents + Gemini + Notion MCP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${splineMono.variable} ${fraunces.variable}`}>
      <body className={`${jakarta.variable} ${splineMono.variable} ${fraunces.variable} subpixel-antialiased`}>
        <CopilotKitProviderShell>{children}</CopilotKitProviderShell>
      </body>
    </html>
  );
}

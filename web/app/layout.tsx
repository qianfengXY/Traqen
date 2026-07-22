import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://traqen-traceability.xahj50675.chatgpt.site"),
  title: "Traqen · 可追溯质量工作台",
  description: "从业务声明、实现事实和测试执行一路追溯到当前部署证据。",
  openGraph: {
    title: "Traqen · Analysis Agent",
    description: "可恢复、可增量的软件工程分析与端到端功能追溯。",
    images: [{ url: "/traqen-analysis-agent.png", width: 1731, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Traqen · Analysis Agent",
    description: "可恢复、可增量的软件工程分析与端到端功能追溯。",
    images: ["/traqen-analysis-agent.png"],
  },
};

const themeInitScript = `
  (function() {
    try {
      var theme = window.localStorage.getItem("traqen-theme");
      if (theme && ["enterprise","apple","warm","fresh","minimal"].includes(theme)) {
        document.documentElement.setAttribute("data-theme", theme);
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}

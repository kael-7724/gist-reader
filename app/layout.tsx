import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gist",
  description: "上传英语文章，划词划句，建立自己的语境单词本与句子本。",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{var m=document.cookie.match(/(?:^|; )gist_theme=(light|dark)/);if(m)document.documentElement.dataset.theme=m[1]}catch(e){}" }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}

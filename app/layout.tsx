import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TikTok Embed',
  description: 'Watch TikTok videos inline in iMessage',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://www.tikwm.com" />
        <link rel="dns-prefetch" href="https://www.tikwm.com" />
      </head>
      <body className="bg-black text-white min-h-screen">{children}</body>
    </html>
  );
}

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'FindMyIMEI', description: 'Register your phone and find it if it goes missing.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh p-4">{children}</body>
    </html>
  );
}

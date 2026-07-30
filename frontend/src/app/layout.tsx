import type { Metadata } from 'next';
import { DM_Sans, Inter } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import ContextProvider from '@/context';

const inter = Inter({ subsets: ['latin'] });
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

export const metadata: Metadata = {
  title: 'Governance Seatbelt',
  description: 'Uniswap Governance Simulation Tool',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${dmSans.variable}`}>
        <ContextProvider>
          <Suspense>
            <Navbar />
          </Suspense>
          <main className="pt-20">{children}</main>
        </ContextProvider>
      </body>
    </html>
  );
}

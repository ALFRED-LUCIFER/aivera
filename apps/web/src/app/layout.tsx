import type { Metadata } from 'next';
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// DESIGN.md typography: Bricolage Grotesque headings, Hanken Grotesk text, JetBrains Mono for evidence.
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-bricolage' });
const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-hanken' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'Aivera',
  description: 'Hire on evidence, not claims.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}

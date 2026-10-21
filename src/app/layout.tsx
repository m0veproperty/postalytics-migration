import type { Metadata } from 'next';
import './fonts.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Postalytics | Migration workspace',
  description: 'The shared Postalytics website migration workspace for actions, decisions, documents and launch readiness.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Painel da Luna',
  description: 'Controle operacional da Luna — Nexo Digital',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

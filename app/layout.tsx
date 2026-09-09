import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HUGELLA | Cartón virtual",
  description: "Consulta y gestión de créditos HUGELLA Soluciones Comerciales.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

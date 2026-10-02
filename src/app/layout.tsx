import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Construction Central Services — مركز الخدمات المالية والإدارية لشركات المقاولات",
  description: "Multi-company construction ERP: accounting, finance, HR, procurement, extracts and costing.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "ar";
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body className="antialiased">{children}</body>
    </html>
  );
}

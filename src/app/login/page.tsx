import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pageContext } from "@/server/context";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await pageContext()) redirect("/dashboard");
  const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "ar";
  return (
    <Suspense>
      <LoginForm lang={lang} showDemo={process.env.SHOW_DEMO_ACCOUNTS !== "false"} />
    </Suspense>
  );
}

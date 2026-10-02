"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { useCfg } from "@/ui/configs";

export default function Page() {
  return <ResourcePage cfg={useCfg("payrolls")} />;
}

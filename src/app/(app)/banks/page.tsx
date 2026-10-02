"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { BankReconciliation } from "@/ui/bank-reconciliation";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t } = useApp();
  const accounts = useCfg("bank-accounts");
  const cheques = useCfg("cheques");
  const tx = useCfg("treasury-transactions");
  return (
    <TabbedPage
      title={t("nav.banks")}
      tabs={[
        { key: "accounts", label: t("t.bankAccounts"), render: () => <ResourcePage cfg={accounts} embedded /> },
        { key: "transactions", label: t("t.transactions"), module: "treasury", render: () => <ResourcePage cfg={{ ...tx, base: { kind: "BANK_DEPOSIT,BANK_WITHDRAWAL,BANK_TRANSFER,BANK_RECEIPT,BANK_PAYMENT" } }} embedded /> },
        { key: "cheques", label: t("t.cheques"), render: () => <ResourcePage cfg={cheques} embedded /> },
        { key: "reconciliation", label: t("t.reconciliation"), render: () => <BankReconciliation /> },
      ]}
    />
  );
}

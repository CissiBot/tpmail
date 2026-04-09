import { AppShell } from "@/components/tpmail/app-shell";
import { listProviders } from "@/server/tpmail/service";

export default function Home() {
  return <AppShell initialProviders={listProviders()} />;
}

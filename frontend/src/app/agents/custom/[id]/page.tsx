import type { Metadata } from "next";
import { CustomAgentConsole } from "@/components/agents/builder/CustomAgentConsole";

export const metadata: Metadata = {
  title: "Custom agent - BITAGENTS",
  description: "Signals, agent wallet, chat, run log and generated app for an agent you built.",
};

export default function CustomAgentPage({ params }: { params: { id: string } }) {
  return <CustomAgentConsole agentId={params.id} />;
}

import type { Metadata } from "next";
import { AgentComposer } from "@/components/agents/builder/AgentComposer";

export const metadata: Metadata = {
  title: "Create your strategy - BITAGENTS",
  description: "Describe a trading strategy, compose its spec and deploy it to Aomi.",
};

export default function CreateAgentPage() {
  return <AgentComposer />;
}

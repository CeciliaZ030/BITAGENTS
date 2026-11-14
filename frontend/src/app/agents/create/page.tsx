import type { Metadata } from "next";
import { AgentComposer } from "@/components/agents/builder/AgentComposer";

export const metadata: Metadata = {
  title: "Create your agent - BITAGENTS",
  description: "Describe a trading agent, compose its spec and compile it into an Aomi app.",
};

export default function CreateAgentPage() {
  return <AgentComposer />;
}

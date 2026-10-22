import { AgentTabs } from "./agent-tabs";

export default function AgentLayout({ children }: LayoutProps<"/agent">) {
  return (
    <>
      <p className="mb-1 text-xs font-semibold text-muted">AI agent</p>
      <AgentTabs />
      {children}
    </>
  );
}

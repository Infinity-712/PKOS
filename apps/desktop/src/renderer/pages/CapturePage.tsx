import type { AgentApiClient } from "@pkos/agent-client";
import { QuickInboxCapture } from "../features/capture/QuickInboxCapture.js";
import { QuickStateCapture } from "../features/capture/QuickStateCapture.js";

export function CapturePage(props: { client: AgentApiClient; onStateWritten: () => void }) {
  return (
    <section className="page-grid two-column">
      <QuickInboxCapture client={props.client} />
      <QuickStateCapture client={props.client} onWritten={props.onStateWritten} />
    </section>
  );
}

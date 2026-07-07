import type { ContextSourceResult } from "./ContextTypes.js";
import { withEstimatedChars } from "./ContextTypes.js";

export class StaticPolicyContextSource {
  load(): ContextSourceResult {
    return {
      warnings: [],
      items: [
        withEstimatedChars({
          id: "static.system_boundary.v1",
          kind: "system_boundary",
          authority: "policy",
          source: { type: "static" },
          stale: false,
          priority: 100,
          content: {
            rules: [
              "Agent runtime is not PKOS authority.",
              "Agent must not directly write trusted, objects, formal tasks, or governance docs.",
              "Runtime and retrieved context may be stale or incomplete.",
              "Human judgment remains final.",
            ],
          },
        }),
      ],
    };
  }
}

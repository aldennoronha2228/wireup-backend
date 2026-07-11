import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GatewayRequestSchema } from "@wireup/schemas";
import type { StreamEvent } from "@wireup/types";

export const chatRoutes = new Hono();

chatRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = GatewayRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  return streamSSE(c, async (stream) => {
    try {
      // Call orchestrator's streaming endpoint
      const response = await fetch(
        `${process.env.ORCHESTRATOR_URL || "http://localhost:3001"}/api/orchestrate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      if (!response.ok || !response.body) {
        throw new Error("Orchestrator failed to respond");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              break;
            }
            try {
              const event: StreamEvent = JSON.parse(data);
              await stream.writeSSE({
                data: JSON.stringify(event),
                event: event.type,
              });
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error in chat stream:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          timestamp: new Date(),
          data: { message: "Internal server error" },
        }),
        event: "error",
      });
    }
  });
});

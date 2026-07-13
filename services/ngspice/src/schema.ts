import { z } from "zod";

export const CircuitEndpointSchema = z.object({
  componentId: z.string(),
  pinName: z.string(),
  platformPin: z.string().optional(),
});

export const CircuitConnectionSchema = z.object({
  from: CircuitEndpointSchema,
  to: CircuitEndpointSchema,
  type: z.enum(["digital", "analog", "power", "ground"]),
});

export const CircuitComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  specifications: z.record(z.unknown()).optional(),
  quantity: z.number().int().optional(),
});

export const BoardMetadataSchema = z.object({
  platform: z.string(),
  voltage: z.number().optional(),
  groundPins: z.array(z.string()).optional(),
  powerPins: z.array(z.string()).optional(),
});

export const NgspiceRequestSchema = z.object({
  circuitId: z.string().optional(),
  components: z.array(CircuitComponentSchema),
  connections: z.array(CircuitConnectionSchema),
  board: BoardMetadataSchema,
});

export const NgspiceIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  componentId: z.string().optional(),
  pinName: z.string().optional(),
  node: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export const NgspiceResponseSchema = z.object({
  errors: z.array(NgspiceIssueSchema),
  warnings: z.array(NgspiceIssueSchema),
  voltages: z.record(z.number()),
  currents: z.record(z.number()),
  summary: z.object({
    status: z.enum(["valid", "invalid"]),
    totalErrors: z.number().int(),
    totalWarnings: z.number().int(),
    ngspiceExitCode: z.number().int().nullable(),
    suggestedFixes: z.array(z.string()).optional(),
  }),
});

export type NgspiceRequest = z.infer<typeof NgspiceRequestSchema>;
export type NgspiceResponse = z.infer<typeof NgspiceResponseSchema>;

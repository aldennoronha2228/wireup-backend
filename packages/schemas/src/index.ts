import { z } from "zod";
import {
  ProjectStatus,
  HardwarePlatformType,
  ValidationErrorType,
  ValidationWarningType,
  SimulationStatus,
  StreamEventType,
} from "@wireup/types";
import type {
  Project,
  Session,
  RagQuery,
  RagContextItem,
  RagResponse,
  ContextBuilderRequest,
  ContextBuilderResponse,
  PlannerRequest,
  PlannerResponse,
  HardwarePlatform,
  Pinout,
  Sensor,
  Component,
  PinAssignment,
  WiringPlan,
  Connection,
  SimulationRequirements,
  InputSignal,
  ExpectedOutput,
  GeneratorRequest,
  GeneratorResponse,
  WiringMetadata,
  Firmware,
  AssemblyInstruction,
  ProjectMetadata,
  SimulationJson,
  SimulationComponent,
  SimulationConnection,
  SimulationSetup,
  ValidatorRequest,
  ValidatorResponse,
  ValidationError,
  ValidationWarning,
  SimulatorRequest,
  SimulatorResponse,
  PinValue,
  SensorValue,
  ExecutionLog,
  StorageProject,
  StorageProjectCreateRequest,
  StorageProjectUpdateRequest,
  StorageSessionCreateRequest,
  ConversationMessage,
  StreamEvent,
  ApiResponse,
  ApiError,
  GatewayRequest,
  GatewayStreamResponse,
} from "@wireup/types";

// ======================
// Core Schemas
// ======================

export const ProjectStatusSchema = z.nativeEnum(ProjectStatus) satisfies z.ZodType<ProjectStatus>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  ownerId: z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  status: ProjectStatusSchema,
}) satisfies z.ZodType<Project>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  isActive: z.boolean(),
}) satisfies z.ZodType<Session>;

// ======================
// RAG Schemas
// ======================

export const RagQuerySchema = z.object({
  query: z.string().min(1),
  projectId: z.string().uuid().optional(),
  topK: z.number().int().positive().optional(),
}) satisfies z.ZodType<RagQuery>;

export const RagContextItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["vector", "knowledge_graph"]),
  content: z.string(),
  metadata: z.record(z.unknown()),
  score: z.number(),
}) satisfies z.ZodType<RagContextItem>;

export const RagResponseSchema = z.object({
  query: z.string(),
  context: z.array(RagContextItemSchema),
  totalHits: z.number().int(),
}) satisfies z.ZodType<RagResponse>;

// ======================
// Context Builder Schemas
// ======================

export const ContextBuilderRequestSchema = z.object({
  query: z.string().min(1),
  ragResponse: RagResponseSchema,
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<ContextBuilderRequest>;

export const ContextBuilderResponseSchema = z.object({
  query: z.string(),
  context: z.array(RagContextItemSchema),
  totalHits: z.number().int(),
  compressionRatio: z.number(),
}) satisfies z.ZodType<ContextBuilderResponse>;

// ======================
// Planner Schemas
// ======================

export const HardwarePlatformTypeSchema = z.nativeEnum(HardwarePlatformType) satisfies z.ZodType<HardwarePlatformType>;

export const PinoutSchema = z.object({
  pinNumber: z.string(),
  function: z.string(),
  voltage: z.number(),
}) satisfies z.ZodType<Pinout>;

export const HardwarePlatformSchema = z.object({
  type: HardwarePlatformTypeSchema,
  name: z.string(),
  pinout: z.array(PinoutSchema),
}) satisfies z.ZodType<HardwarePlatform>;

export const PinAssignmentSchema = z.object({
  componentId: z.string(),
  pinName: z.string(),
  platformPin: z.string(),
}) satisfies z.ZodType<PinAssignment>;

export const SensorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  pins: z.array(PinAssignmentSchema),
}) satisfies z.ZodType<Sensor>;

export const ComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["sensor", "actuator", "power", "other"]),
  category: z.string(),
  description: z.string(),
  specifications: z.record(z.unknown()),
  quantity: z.number().int().positive(),
}) satisfies z.ZodType<Component>;

export const ConnectionSchema = z.object({
  from: PinAssignmentSchema,
  to: PinAssignmentSchema,
  type: z.enum(["digital", "analog", "power", "ground"]),
}) satisfies z.ZodType<Connection>;

export const WiringPlanSchema = z.object({
  connections: z.array(ConnectionSchema),
  notes: z.array(z.string()),
}) satisfies z.ZodType<WiringPlan>;

export const InputSignalSchema = z.object({
  pin: z.string(),
  type: z.enum(["digital", "analog"]),
  values: z.array(z.number()),
  intervalMs: z.number().int().positive(),
}) satisfies z.ZodType<InputSignal>;

export const ExpectedOutputSchema = z.object({
  pin: z.string(),
  type: z.enum(["digital", "analog"]),
  expectedValues: z.array(z.number()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}) satisfies z.ZodType<ExpectedOutput>;

export const SimulationRequirementsSchema = z.object({
  duration: z.number().int().positive(),
  inputSignals: z.array(InputSignalSchema),
  expectedOutputs: z.array(ExpectedOutputSchema),
}) satisfies z.ZodType<SimulationRequirements>;

export const PlannerRequestSchema = z.object({
  prompt: z.string().min(1),
  ragContext: z.array(RagContextItemSchema),
  projectId: z.string().uuid().optional(),
  projectState: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<PlannerRequest>;

export const PlannerResponseSchema = z.object({
  projectRequirements: z.array(z.string()),
  hardwarePlatform: HardwarePlatformSchema,
  sensors: z.array(SensorSchema),
  firmwareGoals: z.array(z.string()),
  requiredComponents: z.array(ComponentSchema),
  wiringPlan: WiringPlanSchema,
  wiringStrategy: z.string(),
  libraries: z.array(z.string()),
  simulationRequirements: SimulationRequirementsSchema,
}) satisfies z.ZodType<PlannerResponse>;

// ======================
// Generator Schemas
// ======================

export const FirmwareSchema = z.object({
  language: z.enum(["c", "python", "arduino"]),
  code: z.string(),
  libraries: z.array(z.string()),
}) satisfies z.ZodType<Firmware>;

export const AssemblyInstructionSchema = z.object({
  step: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  diagramRef: z.string().optional(),
}) satisfies z.ZodType<AssemblyInstruction>;

export const ProjectMetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
}) satisfies z.ZodType<ProjectMetadata>;

export const SimulationComponentSchema = z.object({
  id: z.string(),
  type: z.string(),
  properties: z.record(z.unknown()),
  position: z.object({ x: z.number(), y: z.number() }),
}) satisfies z.ZodType<SimulationComponent>;

export const SimulationConnectionSchema = z.object({
  from: z.object({ componentId: z.string(), pin: z.string() }),
  to: z.object({ componentId: z.string(), pin: z.string() }),
}) satisfies z.ZodType<SimulationConnection>;

export const SimulationSetupSchema = z.object({
  timeStep: z.number().positive(),
  duration: z.number().int().positive(),
}) satisfies z.ZodType<SimulationSetup>;

export const SimulationJsonSchema = z.object({
  version: z.string(),
  components: z.array(SimulationComponentSchema),
  connections: z.array(SimulationConnectionSchema),
  setup: SimulationSetupSchema,
}) satisfies z.ZodType<SimulationJson>;

export const GeneratorRequestSchema = z.object({
  plannerOutput: PlannerResponseSchema,
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<GeneratorRequest>;

export const WiringMetadataSchema = z.object({
  totalConnections: z.number().int().nonnegative(),
  analogConnections: z.number().int().nonnegative(),
  digitalConnections: z.number().int().nonnegative(),
  powerConnections: z.number().int().nonnegative(),
  groundConnections: z.number().int().nonnegative(),
  pinUsage: z.record(z.array(z.string())),
}) satisfies z.ZodType<WiringMetadata>;

export const GeneratorResponseSchema = z.object({
  firmware: FirmwareSchema,
  wiring: WiringPlanSchema,
  componentList: z.array(ComponentSchema),
  assemblyInstructions: z.array(AssemblyInstructionSchema),
  projectMetadata: ProjectMetadataSchema,
  wiringMetadata: WiringMetadataSchema,
  simulationJson: SimulationJsonSchema,
}) satisfies z.ZodType<GeneratorResponse>;

// ======================
// Validator Schemas
// ======================

export const ValidationErrorTypeSchema = z.nativeEnum(ValidationErrorType) satisfies z.ZodType<ValidationErrorType>;

export const ValidationErrorSchema = z.object({
  type: ValidationErrorTypeSchema,
  message: z.string(),
  details: z.record(z.unknown()),
}) satisfies z.ZodType<ValidationError>;

export const ValidationWarningTypeSchema = z.nativeEnum(ValidationWarningType) satisfies z.ZodType<ValidationWarningType>;

export const ValidationWarningSchema = z.object({
  type: ValidationWarningTypeSchema,
  message: z.string(),
  details: z.record(z.unknown()),
}) satisfies z.ZodType<ValidationWarning>;

export const ValidatorRequestSchema = z.object({
  generatorOutput: GeneratorResponseSchema,
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<ValidatorRequest>;

export const ValidatorResponseSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationWarningSchema),
}) satisfies z.ZodType<ValidatorResponse>;

// ======================
// Simulator Schemas
// ======================

export const SimulationStatusSchema = z.nativeEnum(SimulationStatus) satisfies z.ZodType<SimulationStatus>;

export const PinValueSchema = z.object({
  timestamp: z.number().int().positive(),
  value: z.union([z.number(), z.boolean()]),
}) satisfies z.ZodType<PinValue>;

export const SensorValueSchema = z.object({
  timestamp: z.number().int().positive(),
  value: z.union([z.number(), z.record(z.unknown())]),
}) satisfies z.ZodType<SensorValue>;

export const ExecutionLogSchema = z.object({
  timestamp: z.number().int().positive(),
  level: z.enum(["info", "warn", "error", "debug"]),
  message: z.string(),
}) satisfies z.ZodType<ExecutionLog>;

export const SimulatorRequestSchema = z.object({
  simulationJson: SimulationJsonSchema,
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<SimulatorRequest>;

export const SimulatorResponseSchema = z.object({
  simulationId: z.string().uuid(),
  status: SimulationStatusSchema,
  pinValues: z.record(z.array(PinValueSchema)),
  sensorValues: z.record(z.array(SensorValueSchema)),
  executionLogs: z.array(ExecutionLogSchema),
}) satisfies z.ZodType<SimulatorResponse>;

// ======================
// Storage Schemas
// ======================

export const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<ConversationMessage>;

export const StorageProjectSchema = ProjectSchema.extend({
  plannerOutput: PlannerResponseSchema.optional(),
  generatorOutput: GeneratorResponseSchema.optional(),
  validatorOutput: ValidatorResponseSchema.optional(),
  simulationHistory: z.array(SimulatorResponseSchema).optional(),
  conversationHistory: z.array(ConversationMessageSchema).optional(),
}) satisfies z.ZodType<StorageProject>;

export const StorageProjectCreateRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  ownerId: z.string().uuid(),
}) satisfies z.ZodType<StorageProjectCreateRequest>;

export const StorageProjectUpdateRequestSchema = z.object({
  status: ProjectStatusSchema.optional(),
  plannerOutput: PlannerResponseSchema.optional(),
  generatorOutput: GeneratorResponseSchema.optional(),
  validatorOutput: ValidatorResponseSchema.optional(),
  simulationResult: SimulatorResponseSchema.optional(),
  conversationMessage: ConversationMessageSchema.optional(),
}) satisfies z.ZodType<StorageProjectUpdateRequest>;

export const StorageSessionCreateRequestSchema = z.object({
  userId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<StorageSessionCreateRequest>;

// ======================
// Streaming Schemas
// ======================

export const StreamEventTypeSchema = z.nativeEnum(StreamEventType) satisfies z.ZodType<StreamEventType>;

export const StreamEventSchema = z.object({
  type: StreamEventTypeSchema,
  timestamp: z.coerce.date(),
  data: z.record(z.unknown()),
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<StreamEvent>;

// ======================
// API Contract Schemas
// ======================

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<ApiError>;

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: ApiErrorSchema.optional(),
  }) satisfies z.ZodType<ApiResponse<z.infer<T>>>;

export const GatewayRequestSchema = z.object({
  sessionId: z.string().uuid(),
  prompt: z.string().min(1),
  projectId: z.string().uuid().optional(),
}) satisfies z.ZodType<GatewayRequest>;

export const GatewayStreamResponseSchema = z.object({
  events: z.array(StreamEventSchema),
  finalResult: StorageProjectSchema.optional(),
}) satisfies z.ZodType<GatewayStreamResponse>;

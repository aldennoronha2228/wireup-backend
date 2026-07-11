// ======================
// Core Types
// ======================

export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  status: ProjectStatus;
}

export enum ProjectStatus {
  CREATED = "created",
  PLANNING = "planning",
  GENERATING = "generating",
  VALIDATING = "validating",
  SIMULATING = "simulating",
  COMPLETED = "completed",
  ERROR = "error",
}

export interface Session {
  id: string;
  userId: string;
  projectId?: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

// ======================
// RAG Types
// ======================

export interface RagQuery {
  query: string;
  projectId?: string;
  topK?: number;
}

export interface RagContextItem {
  id: string;
  type: "vector" | "knowledge_graph";
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface RagResponse {
  query: string;
  context: RagContextItem[];
  totalHits: number;
}

// ======================
// Context Builder Types
// ======================

export interface ContextBuilderRequest {
  query: string;
  ragResponse: RagResponse;
  projectId?: string;
}

export interface ContextBuilderResponse {
  query: string;
  context: RagContextItem[];
  totalHits: number;
  compressionRatio: number;
}

// ======================
// Planner Types
// ======================

export interface PlannerRequest {
  prompt: string;
  ragContext: RagContextItem[];
  projectId?: string;
  projectState?: Record<string, unknown>;
}

export interface PlannerResponse {
  projectRequirements: string[];
  hardwarePlatform: HardwarePlatform;
  sensors: Sensor[];
  firmwareGoals: string[];
  requiredComponents: Component[];
  wiringPlan: WiringPlan;
  wiringStrategy: string;
  libraries: string[];
  simulationRequirements: SimulationRequirements;
}

export enum HardwarePlatformType {
  ARDUINO_UNO = "arduino_uno",
  ARDUINO_NANO = "arduino_nano",
  ESP32 = "esp32",
  RASPBERRY_PI = "raspberry_pi",
  STM32 = "stm32",
}

export interface HardwarePlatform {
  type: HardwarePlatformType;
  name: string;
  pinout: Pinout[];
}

export interface Pinout {
  pinNumber: string;
  function: string;
  voltage: number;
}

export interface Sensor {
  id: string;
  name: string;
  type: string;
  description: string;
  pins: PinAssignment[];
}

export interface Component {
  id: string;
  name: string;
  type: "sensor" | "actuator" | "power" | "other";
  description: string;
  specifications: Record<string, unknown>;
  quantity: number;
}

export interface PinAssignment {
  componentId: string;
  pinName: string;
  platformPin: string;
}

export interface WiringPlan {
  connections: Connection[];
  notes: string[];
}

export interface Connection {
  from: PinAssignment;
  to: PinAssignment;
  type: "digital" | "analog" | "power" | "ground";
}

export interface SimulationRequirements {
  duration: number;
  inputSignals: InputSignal[];
  expectedOutputs: ExpectedOutput[];
}

export interface InputSignal {
  pin: string;
  type: "digital" | "analog";
  values: number[];
  intervalMs: number;
}

export interface ExpectedOutput {
  pin: string;
  type: "digital" | "analog";
  expectedValues?: number[];
  min?: number;
  max?: number;
}

// ======================
// Generator Types
// ======================

export interface GeneratorRequest {
  plannerOutput: PlannerResponse;
  projectId?: string;
}

export interface WiringMetadata {
  totalConnections: number;
  analogConnections: number;
  digitalConnections: number;
  powerConnections: number;
  groundConnections: number;
  pinUsage: Record<string, string[]>;
}

export interface GeneratorResponse {
  firmware: Firmware;
  wiring: WiringPlan;
  componentList: Component[];
  assemblyInstructions: AssemblyInstruction[];
  projectMetadata: ProjectMetadata;
  wiringMetadata: WiringMetadata;
  simulationJson: SimulationJson;
}

export interface Firmware {
  language: "c" | "python" | "arduino";
  code: string;
  libraries: string[];
}

export interface AssemblyInstruction {
  step: number;
  title: string;
  description: string;
  diagramRef?: string;
}

export interface ProjectMetadata {
  title: string;
  description: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
}

export interface SimulationJson {
  version: string;
  components: SimulationComponent[];
  connections: SimulationConnection[];
  setup: SimulationSetup;
}

export interface SimulationComponent {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface SimulationConnection {
  from: { componentId: string; pin: string };
  to: { componentId: string; pin: string };
}

export interface SimulationSetup {
  timeStep: number;
  duration: number;
}

// ======================
// Validator Types
// ======================

export interface ValidatorRequest {
  generatorOutput: GeneratorResponse;
  projectId?: string;
}

export interface ValidatorResponse {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export enum ValidationErrorType {
  INCOMPATIBLE_PINS = "incompatible_pins",
  DUPLICATE_GPIO = "duplicate_gpio",
  VOLTAGE_MISMATCH = "voltage_mismatch",
  UNSUPPORTED_COMPONENT = "unsupported_component",
  FIRMWARE_CONSISTENCY = "firmware_consistency",
  MISSING_LIBRARIES = "missing_libraries",
  SIMULATION_COMPATIBILITY = "simulation_compatibility",
}

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  details: Record<string, unknown>;
}

export enum ValidationWarningType {
  POTENTIAL_NOISE = "potential_noise",
  POWER_CONSUMPTION_HIGH = "power_consumption_high",
  UNTESTED_COMPONENT = "untested_component",
}

export interface ValidationWarning {
  type: ValidationWarningType;
  message: string;
  details: Record<string, unknown>;
}

// ======================
// Simulator Types
// ======================

export interface SimulatorRequest {
  simulationJson: SimulationJson;
  projectId?: string;
}

export interface SimulatorResponse {
  simulationId: string;
  status: SimulationStatus;
  pinValues: Record<string, PinValue[]>;
  sensorValues: Record<string, SensorValue[]>;
  executionLogs: ExecutionLog[];
}

export enum SimulationStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  ERROR = "error",
}

export interface PinValue {
  timestamp: number;
  value: number | boolean;
}

export interface SensorValue {
  timestamp: number;
  value: number | Record<string, unknown>;
}

export interface ExecutionLog {
  timestamp: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

// ======================
// Storage Types
// ======================

export interface StorageProject extends Project {
  plannerOutput?: PlannerResponse;
  generatorOutput?: GeneratorResponse;
  validatorOutput?: ValidatorResponse;
  simulationHistory?: SimulatorResponse[];
  conversationHistory?: ConversationMessage[];
}

export interface StorageProjectCreateRequest {
  name: string;
  description?: string;
  ownerId: string;
}

export interface StorageProjectUpdateRequest {
  status?: ProjectStatus;
  plannerOutput?: PlannerResponse;
  generatorOutput?: GeneratorResponse;
  validatorOutput?: ValidatorResponse;
  simulationResult?: SimulatorResponse;
  conversationMessage?: ConversationMessage;
}

export interface StorageSessionCreateRequest {
  userId: string;
  projectId?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ======================
// Streaming Types
// ======================

export enum StreamEventType {
  PROGRESS = "progress",
  PLAN_START = "plan_start",
  PLAN_PROGRESS = "plan_progress",
  PLAN_COMPLETE = "plan_complete",
  GENERATION_START = "generation_start",
  GENERATION_PROGRESS = "generation_progress",
  GENERATION_COMPLETE = "generation_complete",
  VALIDATION_START = "validation_start",
  VALIDATION_PROGRESS = "validation_progress",
  VALIDATION_COMPLETE = "validation_complete",
  SIMULATION_START = "simulation_start",
  SIMULATION_PROGRESS = "simulation_progress",
  SIMULATION_COMPLETE = "simulation_complete",
  ERROR = "error",
}

export interface StreamEvent {
  type: StreamEventType;
  timestamp: Date;
  data: Record<string, unknown>;
  projectId?: string;
}

// ======================
// API Contract Types
// ======================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GatewayRequest {
  sessionId: string;
  prompt: string;
  projectId?: string;
}

export interface GatewayStreamResponse {
  events: StreamEvent[];
  finalResult?: StorageProject;
}

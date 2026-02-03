/**
 * Core types for the pure pipeline architecture.
 *
 * These types define the data structures that flow through pipeline steps.
 * They are independent of storage, UI, or any external dependencies.
 */

// ============================================================================
// Page - the fundamental unit of work
// ============================================================================

export interface Page {
  pageId: string; // "pg001"
  pageNumber: number; // 1
  rawText: string; // Extracted text from PDF
  pageImageBase64: string; // Full page render as base64 PNG
}

export interface PageImage {
  imageId: string; // "pg001_im001" or "pg001_page"
  imageBase64: string;
  width: number;
  height: number;
}

// ============================================================================
// Configuration - passed to steps, not loaded by them
// ============================================================================

export interface StepConfig {
  language: string;
  textTypes: TypeDef[];
  textGroupTypes: TypeDef[];
  sectionTypes: TypeDef[];
  prunedTextTypes: string[];
  prunedSectionTypes: string[];
  imageFilters: ImageFilters;
}

export interface TypeDef {
  key: string;
  description: string;
}

export interface ImageFilters {
  minSide?: number;
  maxSide?: number;
}

// ============================================================================
// LLM Model - abstracted interface for language model calls
// ============================================================================

export interface LLMModel {
  generateObject<T>(options: GenerateObjectOptions): Promise<GenerateObjectResult<T>>;
}

export interface GenerateObjectOptions {
  schema: unknown;
  system?: string;
  messages: Message[];
  validate?: (result: unknown) => ValidationResult;
  maxRetries?: number;
  /** Logging context - optional but recommended for debugging */
  log?: {
    taskType: string;
    pageId?: string;
    promptName: string;
  };
}

export interface GenerateObjectResult<T> {
  object: T;
  usage?: TokenUsage;
  cached?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
}

export type ContentPart = TextPart | ImagePart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  image: string; // base64
}

// ============================================================================
// Prompt Templates - structured prompts passed to steps
// ============================================================================

export interface PromptTemplate<TContext = unknown> {
  system: string;
  buildMessages: (context: TContext) => Message[];
}

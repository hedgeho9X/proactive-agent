export type EvidenceKind = "ax" | "screenshot" | "ocr";
export type EvidenceStatus =
  | "pending"
  | "captured"
  | "shared"
  | "unavailable"
  | "timed_out"
  | "excluded"
  | "skipped_by_policy"
  | "dropped_by_backpressure"
  | "expired";
export interface ActionEnvelope {
  schema_version: string;
  action_id: string;
  capture_session_id: string;
  collector_epoch: string;
  source_sequence: string;
  occurred_at: string;
  received_at: string;
  monotonic_ns: string;
  timezone: string;
  kind: string;
  actor: string;
  origin: string;
  trust_class: string;
  app?: { pid?: number; bundle_id?: string; name?: string };
  window?: Record<string, unknown>;
  input?: Record<string, unknown>;
  target_hint?: Record<string, unknown>;
  policy_status: string;
  reason_codes: string[];
}
export interface AXNode {
  node_id: string;
  parent_id: string | null;
  role?: string;
  title?: string;
  value?: string;
  focused?: boolean;
  clicked?: boolean;
  changed?: boolean;
  protected?: boolean;
  visible?: boolean;
  [key: string]: unknown;
}
export interface ArtifactInput {
  slot?: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  capturedAt: string;
  payload?: unknown;
  bytes?: Uint8Array;
  reason?: string;
  screenshotArtifactId?: string;
  metadata?: Record<string, unknown>;
}
export interface EvidenceLink {
  slot: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  artifact_id: string | null;
  original_artifact_id: string | null;
  reason: string | null;
  delta_ms: number | null;
}
export interface Observation {
  action: ActionEnvelope;
  activity_id: string;
  revision: number;
  evidence: EvidenceLink[];
}
export interface CollectorStatus {
  state: "stopped" | "starting" | "stopping" | "running" | "unavailable";
  permissions?: Record<string, boolean>;
  reason?: string;
}

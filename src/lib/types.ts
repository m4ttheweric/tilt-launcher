export type ResourceKind = 'serve' | 'cmd' | 'unknown';

export interface CachedResource {
  name: string;
  label: string;
  category?: string | undefined;
  type?: string | undefined;
  endpoint?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
  runtimeStatus?: string | undefined;
  isDisabled?: boolean | undefined;
  resourceKind?: ResourceKind | undefined;
  // New fields from UIResource status
  updateStatus?: string | undefined;
  waitingReason?: string | undefined;
  waitingOn?: string[] | undefined;
  lastDeployTime?: string | undefined;
  lastBuildDuration?: number | undefined;
  lastBuildError?: string | undefined;
  hasPendingChanges?: boolean | undefined;
  triggerMode?: number | undefined;
  queued?: boolean | undefined;
  order?: number | undefined;
  pid?: number | undefined;
  conditions?: Array<{ type: string; status: string; lastTransitionTime?: string }> | undefined;
}

export interface ServiceGroup {
  id: string;
  label: string;
  resourceNames: string[];
}

export interface SubServiceMapping {
  parentName: string;
  childName: string;
}

export interface ServiceMapping {
  groups: ServiceGroup[];
  subServices: SubServiceMapping[];
  labelOverrides: Record<string, string>;
  resourceOrder: string[];
  hiddenResources: string[];
}

export interface Environment {
  id: string;
  name: string;
  /** True when this environment is an externally-managed Tilt process (port-only). */
  external?: boolean | undefined;
  repoDir: string;
  tiltfile: string;
  tiltPort: number;
  description?: string | undefined;
  isSymlink?: boolean | undefined;
  selectedResources?: string[] | undefined;
  cachedResources?: CachedResource[] | undefined;
  serviceMapping?: ServiceMapping | undefined;
}

export interface PickedTiltfile {
  path: string;
  isSymlink: boolean;
  /** Resolved real path (absolute) when isSymlink is true */
  realPath?: string | undefined;
}

export interface Config {
  port: number;
  dashboardUrl?: string | undefined;
  themeMode?: 'dark' | 'light' | 'system' | undefined;
  environments: Environment[];
}

export interface EnvStatus {
  status: 'stopped' | 'starting' | 'running';
  logs: string[];
  resourceLogs?: Record<string, string[]> | undefined;
  tiltPort: number;
  uptime: number | null;
  newResources?: number | undefined;
  resources?: ResourceRow[] | undefined;
}

export type HealthStatus = 'up' | 'down' | 'unknown' | 'missing';

export interface ResourceRow {
  key: string;
  name: string;
  label: string;
  category: string;
  endpoint?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
  runtimeStatus: string;
  isDisabled: boolean;
  health: HealthStatus;
  exists: boolean;
  error?: string | undefined;
  resourceKind: ResourceKind;
  // New fields from UIResource status
  updateStatus?: string | undefined;
  waitingReason?: string | undefined;
  waitingOn?: string[] | undefined;
  lastDeployTime?: string | undefined;
  lastBuildDuration?: number | undefined;
  lastBuildError?: string | undefined;
  hasPendingChanges?: boolean | undefined;
  triggerMode?: number | undefined;
  queued?: boolean | undefined;
  order?: number | undefined;
  pid?: number | undefined;
  conditions?: Array<{ type: string; status: string; lastTransitionTime?: string }> | undefined;
}

/** Log-free status for a single environment (used in delta IPC) */
export interface EnvStatusUpdate {
  status: 'stopped' | 'starting' | 'running';
  tiltPort: number;
  uptime: number | null;
  newResources?: number | undefined;
  resources?: ResourceRow[] | undefined;
}

/** Status push — resources + env state, NO logs */
export interface StatusUpdate {
  envs: Record<string, EnvStatusUpdate>;
}

/** Incremental log append — only new lines since last push */
export interface LogDelta {
  /** New launcher log lines per env (envId → lines) */
  envLogs: Record<string, string[]>;
  /** New resource log lines ("envId:resourceName" → lines) */
  resourceLogs: Record<string, string[]>;
}

/** @deprecated Use StatusUpdate for push updates. Kept for initial full-fetch. */
export interface StatusResponse {
  envs: Record<string, EnvStatus>;
  health?: Record<string, HealthStatus>;
}

export interface DiscoverResult {
  ok: boolean;
  resources: CachedResource[];
  logs: string[];
  error?: string;
}

export interface LoginItemSettings {
  openAtLogin: boolean;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  /** Raw link target as returned by readlink (may be relative) */
  symlinkTarget?: string | undefined;
  /** Absolute resolved path when isSymlink is true */
  realPath?: string | undefined;
}

export interface ReadDirResult {
  ok: boolean;
  path: string;
  entries: DirEntry[];
  error?: string | undefined;
}

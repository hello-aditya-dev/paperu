/**
 * @paperu/contracts — progress.ts
 *
 * Output metadata and progress-event shapes shared by the task
 * engine and the operations catalogue.
 */

import type {
  ByteSize,
  FileKind,
  FilePath,
  IsoTimestamp,
  TaskId,
} from "./common.js";
import type { TaskProgress, TaskOutcome } from "./tasks.js";

/**
 * Metadata about a file produced (or inspected) by Paperu. Mirrors
 * a subset of `InspectFileResponse` so the UI can render outputs
 * consistently.
 */
export interface OutputMetadata {
  readonly path: FilePath;
  readonly fileName: string;
  readonly kind: FileKind;
  readonly size: ByteSize;
  readonly createdAt?: IsoTimestamp;
  /** Whether this output is in a synced folder. */
  readonly inSyncedFolder?: boolean;
}

/** Payload of the `paperu://task/progress` event. */
export interface TaskProgressEvent {
  readonly taskId: TaskId;
  readonly progress: TaskProgress;
}

/** Payload of the `paperu://task/finished` event. */
export interface TaskFinishedEvent {
  readonly taskId: TaskId;
  readonly outcome: TaskOutcome;
}

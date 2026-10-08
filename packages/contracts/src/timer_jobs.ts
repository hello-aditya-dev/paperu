export interface TimerJob {
  readonly id: string;
  readonly name: string;
  readonly scheduleKind: string;
  readonly scheduleExpr: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly enabled: boolean;
  readonly timezone: string;
  readonly lastRun: string | null;
  readonly lastError: string | null;
  readonly nextRun: string | null;
  readonly createdAt: string;
}
export interface CreateTimerRequest {
  readonly name: string;
  readonly scheduleKind: string;
  readonly scheduleExpr: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
}
export interface UpdateTimerRequest {
  readonly id: string;
  readonly name?: string;
  readonly scheduleKind?: string;
  readonly scheduleExpr?: string;
  readonly actionType?: string;
  readonly actionId?: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
}
export interface TimerJobHistory {
  readonly id: string;
  readonly jobId: string;
  readonly occurrenceKey: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: string;
  readonly message?: string | null;
}
export const TimerJobsCommand = {
  Create: "create_timer_job",
  List: "list_timer_jobs",
  Delete: "delete_timer_job",
  Toggle: "toggle_timer_job",
  Update: "update_timer_job",
  GetHistory: "get_timer_job_history",
  TriggerNow: "trigger_timer_job_now",
} as const;

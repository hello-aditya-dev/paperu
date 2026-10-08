export interface TimerJob {
  readonly id: string;
  readonly name: string;
  readonly scheduleKind: string;
  readonly scheduleExpr: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly enabled: boolean;
  readonly lastRun: string | null;
  readonly nextRun: string | null;
  readonly createdAt: string;
}
export interface CreateTimerRequest {
  readonly name: string;
  readonly scheduleKind: string;
  readonly scheduleExpr: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly enabled?: boolean;
}
export const TimerJobsCommand = {
  Create: "create_timer_job",
  List: "list_timer_jobs",
  Delete: "delete_timer_job",
  Toggle: "toggle_timer_job",
} as const;

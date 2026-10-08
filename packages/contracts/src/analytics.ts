export interface AnalyticsEvent {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly detail: string | null;
}
export const AnalyticsCommand = {
  Log: "log_analytics_event",
  List: "list_analytics_events",
  Clear: "clear_analytics_events",
  Count: "analytics_event_count",
} as const;

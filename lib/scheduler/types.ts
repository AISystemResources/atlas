/**
 * Types for the Atlas scheduler subsystem.
 * Mirrors the Python runner's scan window + user schedule model.
 */

export type ScheduleWindow =
  | "premarket"
  | "open"
  | "midmorning"
  | "midday"
  | "afternoon"
  | "close"

export interface UserSchedule {
  /** Clerk user ID */
  userId: string
  /** Trading ticker symbol, e.g. "AAPL" */
  ticker: string
  /** Which window this entry fires on */
  windowName: ScheduleWindow
  /** Whether this schedule entry is active */
  isEnabled: boolean
  /** Trading mode for this user */
  mode: "advisory" | "autonomous"
}

export interface PipelineEvent {
  name: "app/pipeline.triggered"
  data: {
    userId: string
    ticker: string
    mode: "advisory" | "autonomous"
    asOfDate: string
  }
}

export interface DispatchResult {
  window: ScheduleWindow
  triggered_count: number
  duration_ms: number
}

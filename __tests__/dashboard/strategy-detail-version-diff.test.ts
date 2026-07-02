/**
 * Sprint 120: unit tests for the version-diff helpers on the strategy
 * detail page. The visual components (VersionTimeline, WhyPanel) are
 * covered by manual QA; these tests guard the tunable-path → stage-number
 * mapping that drives the inline PLAYBOOK tint.
 */

import {
  tunablePathToStageNumber,
  computeChangedStageNumbers,
} from "@/app/dashboard/strategies/[id]/StrategyDetailClient";
import type { TunableParameter } from "@/lib/strategies/types";

describe("tunablePathToStageNumber", () => {
  it("maps session_window to stage 01", () => {
    expect(tunablePathToStageNumber(["session_window", "start"])).toBe("01");
    expect(tunablePathToStageNumber(["session_window", "end"])).toBe("01");
  });

  it("maps entry/computed paths to stage 03 (ENTRY)", () => {
    expect(
      tunablePathToStageNumber(["computed", "entry_price", "right", "value"]),
    ).toBe("03");
    expect(tunablePathToStageNumber(["entry", "sizing", "value"])).toBe("03");
  });

  it("maps exit.stop_loss to stage 04 (STOP)", () => {
    expect(
      tunablePathToStageNumber(["exit", "stop_loss", "right", "value"]),
    ).toBe("04");
  });

  it("maps exit.take_profit to stage 05 (TARGET)", () => {
    expect(tunablePathToStageNumber(["exit", "take_profit"])).toBe("05");
  });

  it("maps exit.time_stop and exit.exit_conditions to stage 06 (EXIT)", () => {
    expect(tunablePathToStageNumber(["exit", "time_stop"])).toBe("06");
    expect(tunablePathToStageNumber(["exit", "exit_conditions"])).toBe("06");
  });

  it("returns null for unknown or empty paths", () => {
    expect(tunablePathToStageNumber(undefined)).toBeNull();
    expect(tunablePathToStageNumber([])).toBeNull();
    expect(tunablePathToStageNumber(["something_else"])).toBeNull();
  });
});

describe("computeChangedStageNumbers", () => {
  const tunables: TunableParameter[] = [
    {
      name: "entry_buffer_points",
      path: ["computed", "entry_price", "right", "value"],
      description: "",
      min: 1,
      max: 100,
    },
    {
      name: "stop_buffer_points",
      path: ["exit", "stop_loss", "right", "value"],
      description: "",
      min: 1,
      max: 100,
    },
    {
      name: "notional_per_trade",
      path: ["entry", "sizing", "value"],
      description: "",
      min: 50,
      max: 10000,
    },
    {
      name: "session_start_et",
      path: ["session_window", "start"],
      description: "",
    },
  ];

  it("collects unique stage numbers for the tunables referenced", () => {
    const stages = computeChangedStageNumbers(
      [
        { name: "entry_buffer_points", current_value: 3, applied_value: 2, original_proposed_value: 2, was_clamped: false, reason: "" },
        { name: "stop_buffer_points", current_value: 2.25, applied_value: 1.7, original_proposed_value: 1.7, was_clamped: false, reason: "" },
      ],
      tunables,
    );
    // entry_buffer_points → 03; stop_buffer_points → 04
    expect(stages).toEqual(new Set(["03", "04"]));
  });

  it("dedupes stages when multiple tunables share one", () => {
    const stages = computeChangedStageNumbers(
      [
        { name: "entry_buffer_points", current_value: 3, applied_value: 2, original_proposed_value: 2, was_clamped: false, reason: "" },
        { name: "notional_per_trade", current_value: 200, applied_value: 250, original_proposed_value: 250, was_clamped: false, reason: "" },
      ],
      tunables,
    );
    // Both live in stage 03
    expect(stages).toEqual(new Set(["03"]));
  });

  it("ignores changes whose tunable isn't in the tunables list", () => {
    const stages = computeChangedStageNumbers(
      [{ name: "phantom_param", current_value: 1, applied_value: 2, original_proposed_value: 2, was_clamped: false, reason: "" }],
      tunables,
    );
    expect(stages.size).toBe(0);
  });

  it("returns empty when the change list is empty", () => {
    expect(computeChangedStageNumbers([], tunables)).toEqual(new Set());
  });
});

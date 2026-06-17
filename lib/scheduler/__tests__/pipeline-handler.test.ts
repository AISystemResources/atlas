/**
 * Tests for scheduler/pipeline-handler.ts
 *
 * Mocks:
 *   - ../../inngest       → fake inngest client (createFunction + send)
 *   - ../../agents/index  → fake runGraph via require() stub
 */

// ── Inngest mock ──────────────────────────────────────────────────────────────

// Inngest v4: createFunction(options, handler) — 2 args.
let capturedHandler: (ctx: { event: { data: unknown }; step: { run: jest.Mock } }) => Promise<unknown>

jest.mock("../../inngest", () => ({
  inngest: {
    createFunction: jest.fn(
      (
        _options: unknown,
        handler: typeof capturedHandler
      ) => {
        capturedHandler = handler
        return { id: "on-pipeline-triggered" }
      }
    ),
    send: jest.fn(),
  },
}))

// ── agents mock ───────────────────────────────────────────────────────────────

const mockRunGraph = jest.fn()

jest.mock("../../agents", () => ({ runGraph: mockRunGraph }))

// ── execute-trade mock ────────────────────────────────────────────────────────

jest.mock("../execute-trade", () => ({
  executeTrade: jest.fn().mockResolvedValue({ skipped: true, reason: "mocked" }),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { onPipelineTriggered } from "../pipeline-handler"
import { inngest } from "../../inngest"

const mockedSend = inngest.send as jest.Mock

// ── Helpers ────────────────────────────────────────────────────────────────────

interface StepRunMock {
  run: jest.Mock
}

function buildStep(): StepRunMock {
  return {
    run: jest.fn().mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn()),
  }
}

function buildEvent(overrides: Partial<{
  userId: string
  ticker: string
  philosophy: string
  mode: "advisory" | "autonomous"
  asOfDate: string
}> = {}) {
  return {
    data: {
      userId: "user_test",
      ticker: "AAPL",
      philosophy: "balanced",
      mode: "advisory" as const,
      asOfDate: "2026-04-23",
      ...overrides,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  // Trigger module import so createFunction is called and capturedHandler is set
  void onPipelineTriggered
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("onPipelineTriggered", () => {
  it("calls runGraph with correct arguments", async () => {
    mockRunGraph.mockResolvedValue({ portfolio_decision: { confidence: 0.8, action: "BUY" } })
    const step = buildStep()

    await capturedHandler({ event: buildEvent({ mode: "advisory" }), step })

    expect(mockRunGraph).toHaveBeenCalledWith("AAPL", {
      mode: "advisory",
      philosophy: "balanced",
      isBacktest: false,
      userId: "user_test",
    })
  })

  it("returns the graph result", async () => {
    const graphResult = { portfolio_decision: { confidence: 0.9, action: "HOLD" } }
    mockRunGraph.mockResolvedValue(graphResult)

    const result = await capturedHandler({
      event: buildEvent({ mode: "advisory" }),
      step: buildStep(),
    })

    expect(result).toEqual(graphResult)
  })

  describe("advisory mode", () => {
    it("does NOT send a notification regardless of confidence", async () => {
      mockRunGraph.mockResolvedValue({ portfolio_decision: { confidence: 0.3, action: "SELL" } })
      mockedSend.mockResolvedValue(undefined)

      await capturedHandler({
        event: buildEvent({ mode: "advisory" }),
        step: buildStep(),
      })

      expect(mockedSend).not.toHaveBeenCalled()
    })
  })

  describe("autonomous mode", () => {
    it("does NOT send a notification when confidence >= 0.65", async () => {
      mockRunGraph.mockResolvedValue({ portfolio_decision: { confidence: 0.65, action: "BUY" } })
      mockedSend.mockResolvedValue(undefined)

      await capturedHandler({
        event: buildEvent({ mode: "autonomous" }),
        step: buildStep(),
      })

      expect(mockedSend).not.toHaveBeenCalled()
    })

    it("does NOT send a notification when confidence is exactly 0.65", async () => {
      mockRunGraph.mockResolvedValue({ portfolio_decision: { confidence: 0.65, action: "HOLD" } })

      await capturedHandler({
        event: buildEvent({ mode: "autonomous" }),
        step: buildStep(),
      })

      expect(mockedSend).not.toHaveBeenCalled()
    })

    it("sends a notification event when confidence < 0.65", async () => {
      const graphResult = { portfolio_decision: { confidence: 0.5, action: "HOLD" } }
      mockRunGraph.mockResolvedValue(graphResult)
      mockedSend.mockResolvedValue(undefined)

      await capturedHandler({
        event: buildEvent({ mode: "autonomous", userId: "user_auto", ticker: "TSLA" }),
        step: buildStep(),
      })

      expect(mockedSend).toHaveBeenCalledTimes(1)
      expect(mockedSend).toHaveBeenCalledWith({
        name: "app/notification.requested",
        data: {
          userId: "user_auto",
          ticker: "TSLA",
          result: graphResult,
        },
      })
    })

    it("sends a notification when confidence is 0", async () => {
      const graphResult = { portfolio_decision: { confidence: 0, action: "HOLD" } }
      mockRunGraph.mockResolvedValue(graphResult)
      mockedSend.mockResolvedValue(undefined)

      await capturedHandler({
        event: buildEvent({ mode: "autonomous" }),
        step: buildStep(),
      })

      expect(mockedSend).toHaveBeenCalledTimes(1)
    })
  })
})

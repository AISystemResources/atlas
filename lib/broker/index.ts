/**
 * Atlas broker adapter layer — re-exports.
 *
 * Usage:
 *   import { BrokerAdapter, BrokerError } from "@/lib/broker"
 *   import { AlpacaAdapter } from "@/lib/broker"
 *   import { MockBrokerAdapter } from "@/lib/broker"
 */

export type { BrokerAdapter } from "./base";
export { BrokerError } from "./base";
export { AlpacaAdapter } from "./alpaca";
export { MockBrokerAdapter } from "./mock";
export { AtlasSimAdapter } from "./atlas-sim";
export type { BarLike, TickBracketsResult } from "./atlas-sim";
export type {
  Account,
  Order,
  OrderAction,
  OrderFilter,
  OrderRequest,
  OrderStatus,
  Position,
} from "./types";

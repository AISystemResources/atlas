import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";

global.fetch = jest.fn();

// jsdom lacks the global Response constructor that Next.js route handlers use.
// Provide a minimal shim so route handlers under test can return Response.json(...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (global as any).Response === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).Response = class {
    body: string;
    status: number;
    constructor(body: string, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(data: unknown, init?: { status?: number }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = new (global as any).Response(JSON.stringify(data), init);
      r.__data = data;
      return r;
    }
    async json() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this as any).__data ?? JSON.parse(this.body);
    }
  };
}
// mongodb → whatwg-url requires TextEncoder/TextDecoder in jsdom
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;
// @langchain/core uses Web Streams API; jsdom doesn't expose Node's built-ins
if (typeof global.ReadableStream === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ReadableStream, WritableStream, TransformStream } = require("stream/web");
  global.ReadableStream = ReadableStream;
  global.WritableStream = WritableStream;
  global.TransformStream = TransformStream;
}

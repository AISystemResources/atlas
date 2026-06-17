import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";

global.fetch = jest.fn();
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

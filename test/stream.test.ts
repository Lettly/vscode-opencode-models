import assert from "node:assert/strict"
import test from "node:test"
import { parseToolArguments } from "../src/stream.js"

test("parses accumulated tool arguments", () => {
  assert.deepEqual(parseToolArguments('{"value":7}'), { value: 7 })
})

test("falls back to an empty object for partial JSON", () => {
  assert.deepEqual(parseToolArguments(""), {})
  assert.deepEqual(parseToolArguments('{"value":'), {})
})

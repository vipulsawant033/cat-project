import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignToFigmaCounter,
  axisToFigmaMode,
  figmaCounterToAlign,
  figmaModeToAxis,
  figmaPrimaryToJustify,
  justifyToFigmaPrimary,
} from "./mapper.js";

test("axis round-trips through figma mode", () => {
  for (const axis of ["row", "column"] as const) {
    assert.equal(figmaModeToAxis(axisToFigmaMode(axis)), axis);
  }
});

test("justify -> primary -> justify is identity for shared values", () => {
  for (const j of ["flex-start", "center", "flex-end", "space-between"] as const) {
    assert.equal(figmaPrimaryToJustify(justifyToFigmaPrimary(j)), j);
  }
});

test("align -> counter -> align is identity for shared values", () => {
  for (const a of ["flex-start", "center", "flex-end"] as const) {
    assert.equal(figmaCounterToAlign(alignToFigmaCounter(a), false), a);
  }
});

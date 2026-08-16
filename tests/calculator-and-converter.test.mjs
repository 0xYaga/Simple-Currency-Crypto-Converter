import assert from "node:assert/strict";
import test from "node:test";
import { appendCalculatorToken, evaluateExpression, tryEvaluateExpression } from "../modules/calculator.js";
import { convertValue, parseAmount } from "../modules/converter.js";

test("calculator evaluates arithmetic without executing input as code", () => {
  assert.equal(evaluateExpression("2*(3+4)-5/2"), 11.5);
  assert.equal(tryEvaluateExpression("1/0").ok, false);
  assert.equal(tryEvaluateExpression("2+alert(1)").ok, false);
  assert.equal(appendCalculatorToken("2", "("), "2*(");
});

test("converter accepts localized amounts and converts from one USD table", () => {
  assert.equal(parseAmount("1 234,50", "ru"), 1234.5);
  assert.equal(parseAmount("1,234.50", "en"), 1234.5);
  assert.equal(convertValue(2, { rates: { usd: 1, eur: 0.5 } }, "usd", "eur"), 1);
});

// Bounded expression parser for the local calculator. It tokenizes and parses
// arithmetic directly instead of evaluating user input as JavaScript.
const MAX_EXPRESSION_LENGTH = 160;
const MAX_ABSOLUTE_RESULT = 1e100;

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function normalizeExpression(expression) {
  return String(expression ?? "")
    .replace(/[×·]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
}

function tokenize(expression) {
  const normalized = normalizeExpression(expression);
  if (!normalized || normalized.length > MAX_EXPRESSION_LENGTH) {
    throw new Error("invalid-expression");
  }

  const tokens = [];
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index];
    if (isDigit(char) || char === ".") {
      let end = index + 1;
      let dotCount = char === "." ? 1 : 0;
      while (end < normalized.length) {
        const next = normalized[end];
        if (isDigit(next)) {
          end += 1;
          continue;
        }
        if (next === "." && dotCount === 0) {
          dotCount += 1;
          end += 1;
          continue;
        }
        if ((next === "e" || next === "E") && end + 1 < normalized.length) {
          let expEnd = end + 1;
          if (normalized[expEnd] === "+" || normalized[expEnd] === "-") expEnd += 1;
          const expStart = expEnd;
          while (expEnd < normalized.length && isDigit(normalized[expEnd])) expEnd += 1;
          if (expEnd === expStart) break;
          end = expEnd;
        }
        break;
      }
      const raw = normalized.slice(index, end);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("invalid-number");
      tokens.push({ type: "number", value });
      index = end;
      continue;
    }

    if ("+-*/()".includes(char)) {
      tokens.push({ type: char });
      index += 1;
      continue;
    }

    throw new Error("invalid-character");
  }
  return tokens;
}

function parseTokens(tokens) {
  let position = 0;

  const peek = () => tokens[position];
  const consume = (type) => {
    if (peek()?.type !== type) return false;
    position += 1;
    return true;
  };

  function parsePrimary() {
    if (consume("+")) return parsePrimary();
    if (consume("-")) return -parsePrimary();
    const token = peek();
    if (token?.type === "number") {
      position += 1;
      return token.value;
    }
    if (consume("(")) {
      const value = parseAdditive();
      if (!consume(")")) throw new Error("missing-parenthesis");
      return value;
    }
    throw new Error("missing-value");
  }

  function parseMultiplicative() {
    let value = parsePrimary();
    while (true) {
      if (consume("*")) {
        value *= parsePrimary();
      } else if (consume("/")) {
        const divisor = parsePrimary();
        if (divisor === 0) throw new Error("division-by-zero");
        value /= divisor;
      } else {
        break;
      }
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_RESULT) throw new Error("overflow");
    }
    return value;
  }

  function parseAdditive() {
    let value = parseMultiplicative();
    while (true) {
      if (consume("+")) value += parseMultiplicative();
      else if (consume("-")) value -= parseMultiplicative();
      else break;
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_RESULT) throw new Error("overflow");
    }
    return value;
  }

  const result = parseAdditive();
  if (position !== tokens.length) throw new Error("unexpected-token");
  if (!Number.isFinite(result) || Math.abs(result) > MAX_ABSOLUTE_RESULT) throw new Error("overflow");
  return Object.is(result, -0) ? 0 : result;
}

export function evaluateExpression(expression) {
  return parseTokens(tokenize(expression));
}

export function tryEvaluateExpression(expression) {
  try {
    return { ok: true, value: evaluateExpression(expression), error: "" };
  } catch (error) {
    return { ok: false, value: Number.NaN, error: error instanceof Error ? error.message : "invalid-expression" };
  }
}

export function formatCalculatorNumber(value, locale = "en") {
  if (!Number.isFinite(value)) return "Error";
  const absolute = Math.abs(value);
  if ((absolute !== 0 && absolute < 1e-9) || absolute >= 1e15) {
    return value.toExponential(10).replace(/\.0+(?=e)/, "").replace(/(\.\d*?)0+(?=e)/, "$1");
  }
  return new Intl.NumberFormat(locale, {
    useGrouping: true,
    maximumFractionDigits: 12,
    maximumSignificantDigits: 15
  }).format(value);
}

export function numberForExpression(value) {
  if (!Number.isFinite(value)) return "";
  return Number(value.toPrecision(15)).toString();
}

export function displayExpression(expression) {
  return String(expression ?? "")
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/-/g, "−");
}

export function appendCalculatorToken(expression, token, justEvaluated = false) {
  const current = String(expression ?? "");
  const isOperator = ["+", "-", "*", "/"].includes(token);
  let next = justEvaluated && !isOperator ? "" : current;

  if (token === ".") {
    const lastSegment = next.split(/[+\-*/()]/).pop() ?? "";
    if (lastSegment.includes(".")) return next;
    if (!lastSegment) next += "0";
  }

  if (isOperator) {
    if (!next) return token === "-" ? "-" : next;
    if (/[+\-*/]$/.test(next)) return `${next.slice(0, -1)}${token}`;
  }

  if (token === "(") {
    if (/[\d.)]$/.test(next)) next += "*";
  }
  if ((isDigit(token) || token === ".") && /\)$/.test(next)) next += "*";

  const result = `${next}${token}`;
  return result.length <= MAX_EXPRESSION_LENGTH ? result : next;
}

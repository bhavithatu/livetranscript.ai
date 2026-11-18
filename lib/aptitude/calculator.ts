/** A small exact rational calculator: no eval, variables, calls, or generated code. */
type Rational = { n: bigint; d: bigint }
const ZERO = BigInt(0)
const ONE = BigInt(1)
const TEN = BigInt(10)
const abs = (n: bigint) => n < ZERO ? -n : n
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a); b = abs(b)
  while (b !== ZERO) { const next = a % b; a = b; b = next }
  return a || ONE
}
function rational(n: bigint, d = ONE): Rational {
  if (d === ZERO) throw new Error('Division by zero')
  if (d < ZERO) { n = -n; d = -d }
  const g = gcd(n, d); n /= g; d /= g
  if (abs(n).toString().length > 180 || d.toString().length > 180) throw new Error('Calculation exceeds the size limit')
  return { n, d }
}
function decimal(s: string): Rational {
  const [whole, fraction = ''] = s.split('.')
  return rational(BigInt(`${whole || '0'}${fraction}`), TEN ** BigInt(fraction.length))
}
const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d)
const multiply = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d)
const divide = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n)

export type Calculation = { value: number; exact: string }
export function calculateExpression(expression: string, decimalPlaces: number | null = null): Calculation {
  if (!expression.trim() || expression.length > 512) throw new Error('Calculation must contain at most 512 characters')
  if (/[\d.]\s+[\d.]/.test(expression)) throw new Error('Whitespace cannot join numeric literals')
  if (decimalPlaces !== null && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 10)) throw new Error('Unsupported rounding')
  const compact = expression.replace(/\s+/g, '')
  const tokens = compact.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/^()%]/g) ?? []
  if (tokens.join('') !== compact || tokens.length > 160 || tokens.some(t => /^\d/.test(t) && t.length > 30)) throw new Error('Use numbers and arithmetic operators only')
  let at = 0
  let depth = 0
  function primary(): Rational {
    if (++depth > 24) throw new Error('Calculation is too deeply nested')
    const token = tokens[at++]
    let value: Rational
    if (token === '(') {
      value = sum()
      if (tokens[at++] !== ')') throw new Error('Missing closing parenthesis')
    } else if (token && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) value = decimal(token)
    else throw new Error('Expected a number')
    while (tokens[at] === '%') { at++; value = divide(value, rational(BigInt(100))) }
    depth--
    return value
  }
  function power(): Rational {
    let value = primary()
    if (tokens[at] === '^') {
      at++
      const exponent = unary()
      if (exponent.d !== ONE || abs(exponent.n) > BigInt(20)) throw new Error('Use an integer exponent between -20 and 20')
      if (value.n === ZERO && exponent.n === ZERO) throw new Error('Zero to the power zero requires a specified convention')
      const e = abs(exponent.n)
      value = exponent.n < ZERO ? rational(value.d ** e, value.n ** e) : rational(value.n ** e, value.d ** e)
    }
    return value
  }
  function unary(): Rational {
    if (tokens[at] === '+') { at++; return unary() }
    if (tokens[at] === '-') { at++; const value = unary(); return rational(-value.n, value.d) }
    return power()
  }
  function product(): Rational {
    let value = unary()
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++]; const right = unary()
      value = op === '*' ? multiply(value, right) : divide(value, right)
    }
    return value
  }
  function sum(): Rational {
    let value = product()
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++]; const right = product()
      value = add(value, op === '+' ? right : rational(-right.n, right.d))
    }
    return value
  }
  let result = sum()
  if (at !== tokens.length) throw new Error('Unexpected calculation token')
  if (decimalPlaces !== null) {
    const scale = TEN ** BigInt(decimalPlaces)
    const scaled = abs(result.n) * scale
    const rounded = scaled / result.d + ((scaled % result.d) * BigInt(2) >= result.d ? ONE : ZERO)
    result = rational(result.n < ZERO ? -rounded : rounded, scale)
  }
  const value = Number(result.n) / Number(result.d)
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Result is outside the safe display range')
  return { value, exact: result.d === ONE ? result.n.toString() : `${result.n}/${result.d}` }
}

export function numbersAgree(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE) * 4
}

/** Deliberately rejects sentences, ranges, expressions, and numbers hidden in prose. */
export function numericAnswer(text: string | null, unit: string | null = null): number | null {
  if (!text) return null
  let value = text.trim()
  const suffix = unit?.trim()
  if (suffix && value.toLowerCase().endsWith(suffix.toLowerCase())) value = value.slice(0, -suffix.length).trim()
  value = value.replace(/^[$£€₹]\s*/, '').replace(/%$/, '').trim()
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null
  const n = Number(value.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

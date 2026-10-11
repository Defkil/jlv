// The value comparison of the legacy viewer, which sorted with lodash 4.17: the order of lodash.sortBy for two values
// of parsed JSON. The record view uses it for orders by a field other than the time.

// The operand of JavaScript's relational comparison for a value of parsed JSON: an array becomes the text of its
// elements, any other object the text of Object.prototype.toString.
const comparable = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(element => element === undefined || element === null ? '' : comparable(element)).join(',')
  }
  return typeof value === 'object' && value !== null ? '[object Object]' : value
}

// JavaScript's < for comparable values: two texts compare by their UTF-16 code units, anything else as numbers.
const isLessThan = (left: unknown, right: unknown): boolean =>
  typeof left === 'string' && typeof right === 'string' ? left < right : Number(left) < Number(right)

// lodash's compareAscending without symbols: other values by <, then null, then undefined, then NaN. Mixed types
// give no consistent order, exactly as before.
const compareAscending = (value: unknown, other: unknown): number => {
  if (value === other) {
    return 0
  }
  const isValueDefined = value !== undefined
  const isOtherDefined = other !== undefined
  const isValueReflexive = !Number.isNaN(value)
  const isOtherReflexive = !Number.isNaN(other)
  if (!isValueReflexive ||
    (!isValueDefined && isOtherReflexive) ||
    (value === null && isOtherDefined && isOtherReflexive) ||
    (other !== null && isLessThan(comparable(other), comparable(value)))) {
    return 1
  }
  // From here on the value is not NaN, which the first rule would have ordered last.
  return !isOtherReflexive ||
    !isOtherDefined ||
    (other === null && isValueDefined) ||
    (value !== null && isLessThan(comparable(value), comparable(other)))
    ? -1
    : 0
}

export { compareAscending }

// The row order of the legacy viewer, which sorted with lodash 4.17: a stable ascending sort by the value at the
// sort key, reversed as a whole for a descending sort, so equal values then appear in reverse file order.
import { fieldReader } from '../field-path.js'

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

// Sorts by the value at the key, a property path such as level or data.user.name.
const sortRows = <Row>(rows: readonly Row[], key: string, isDescending: boolean): Row[] => {
  const readField = fieldReader(key)
  const sorted = rows
    .map((row, index) => ({ row, index, value: readField(row) }))
    .toSorted((left, right) => compareAscending(left.value, right.value) || left.index - right.index)
    .map(({ row }) => row)
  return isDescending ? sorted.toReversed() : sorted
}

export { compareAscending, sortRows }

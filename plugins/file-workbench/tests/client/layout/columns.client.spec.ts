/** Three-column workbench concession-chain solver tests. */
import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT,
} from '../../../src/client/layout/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(10, 100, 200)).toBe(100)
    expect(clampWidth(999, 100, 200)).toBe(200)
    expect(clampWidth(150.6, 100, 200)).toBe(151)
  })
})

describe('computeColumns', () => {
  it('fits sidebar, center, and details at preference on a wide viewport', () => {
    const cols = computeColumns(2400, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.details).toBe(DETAILS_DEFAULT)
    expect(cols.center).toBe(2400 - SIDEBAR_DEFAULT - DETAILS_DEFAULT)
  })

  it('renders the collapsed rail for a closed sidebar and 0 for closed details', () => {
    const cols = computeColumns(2000, 0, 0)
    expect(cols.sidebar).toBe(SIDEBAR_COLLAPSED)
    expect(cols.details).toBe(0)
    expect(cols.center).toBe(2000 - SIDEBAR_COLLAPSED)
  })

  it('shrinks details toward its minimum, holding center at its floor', () => {
    const width = SIDEBAR_DEFAULT + DETAILS_DEFAULT + CENTER_MIN - 40
    const cols = computeColumns(width, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(cols.center).toBe(CENTER_MIN)
    expect(cols.details).toBeLessThan(DETAILS_DEFAULT)
    expect(cols.details).toBeGreaterThanOrEqual(DETAILS_MIN)
  })

  it('auto-closes details when space runs out, center absorbing the rest', () => {
    const width = SIDEBAR_DEFAULT + CENTER_MIN - 20
    const cols = computeColumns(width, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(cols.details).toBe(0)
    expect(cols.center).toBe(width - SIDEBAR_DEFAULT)
  })

  it('never lets center go negative on a degenerate viewport', () => {
    const cols = computeColumns(20, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(cols.center).toBe(0)
  })

  it('keeps closed details at 0 through the concession steps', () => {
    // Details already closed, but the sidebar + center floor overflow: step 1
    // fails and step 2 runs with d0 === 0, holding details at 0.
    const width = SIDEBAR_DEFAULT + CENTER_MIN - 40
    const cols = computeColumns(width, SIDEBAR_DEFAULT, 0)
    expect(cols.details).toBe(0)
    expect(cols.center).toBe(width - SIDEBAR_DEFAULT)
  })
})

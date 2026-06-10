/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/** Minimal shape the bulk-toggle helpers need from a catalog row. */
export type BulkToggleRow = {
  id: string;
  enabled: boolean;
};

/**
 * Decide which rows a "select all" / "deselect all" action must flip.
 *
 * CRITICAL invariant: the input is the list of CURRENTLY-VISIBLE rows (already
 * filtered by the active search). Hidden rows are never passed in, so they can
 * never be flipped. Only rows whose `enabled` differs from the target are
 * returned — already-correct rows are skipped so the caller makes the minimum
 * number of toggle calls.
 *
 * @param visibleRows rows currently shown after search/filter
 * @param enable target state — `true` = select all, `false` = deselect all
 * @returns ids of the visible rows that need flipping to reach the target
 */
export function rowsToFlip(visibleRows: readonly BulkToggleRow[], enable: boolean): string[] {
  const ids: string[] = [];
  for (const row of visibleRows) {
    if (row.enabled !== enable) {
      ids.push(row.id);
    }
  }
  return ids;
}

/**
 * Whether every currently-visible row is already enabled. Drives the single
 * toggle-all control: when all visible rows are on, the control offers
 * "Deselect all"; otherwise it offers "Select all". An empty list reads as
 * "not all enabled" so the control defaults to the "Select all" affordance.
 */
export function allVisibleEnabled(visibleRows: readonly BulkToggleRow[]): boolean {
  return visibleRows.length > 0 && visibleRows.every((row) => row.enabled);
}

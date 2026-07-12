/**
 * Per-tool teardown when leaving a workspace (e.g. stop camera tracks).
 * Kept separate from main.js so tools can register cleanup without circular imports.
 */

import { releaseAllCameras } from './camera-registry.js';

/** @type {(() => void) | null} */
let activeToolCleanup = null;

/**
 * Register a function to run when the user leaves the current tool workspace.
 * Pass null to clear.
 * @param {(() => void) | null} fn
 */
export function setToolCleanup(fn) {
  activeToolCleanup = typeof fn === 'function' ? fn : null;
}

/** Run and clear the active tool cleanup (if any), then force-release cameras. */
export function runToolCleanup() {
  if (typeof activeToolCleanup === 'function') {
    try {
      activeToolCleanup();
    } catch (err) {
      console.warn('Tool cleanup failed:', err);
    }
  }
  activeToolCleanup = null;
  // Belt-and-suspenders: never leave camera hardware held after leave/close
  try {
    releaseAllCameras();
  } catch (err) {
    console.warn('Camera release failed:', err);
  }
}

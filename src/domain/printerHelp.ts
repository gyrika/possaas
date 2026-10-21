/**
 * What to tell the owner when the test receipt did not come out. Windows cannot tell whether paper
 * came out (a printer that is off often still takes the job and keeps it waiting), so the screen
 * asks the person first, then reads what Windows does know: the printer's state and its queue.
 */
export interface PrinterState {
  /** Windows' PrinterStatus: "Normal", "Offline", "PaperOut", "Paused", "Error", … ('' if unknown). */
  status: string;
  /** Receipts waiting in Windows' queue for this printer. */
  jobs: number;
  /** Windows was told to "Use printer offline". */
  offline: boolean;
}

export interface Advice {
  /** The single most likely cause, in plain words. */
  title: string;
  steps: string[];
  /** Receipts stuck in the queue: offer to clear them, so they do not all print later. */
  clearJobs: boolean;
}

const has = (status: string, ...words: string[]) => words.some((w) => status.toLowerCase().includes(w.toLowerCase()));

const CHECKS = [
  'The printer is switched on and its light is on.',
  'The USB cable is in firmly at both ends (try another USB port on the computer).',
  'There is a paper roll in it, and the lid is closed firmly.',
];

export function printerAdvice(s: PrinterState): Advice {
  const clearJobs = s.jobs > 0;
  const waiting = clearJobs
    ? [`${s.jobs === 1 ? '1 receipt is' : `${s.jobs} receipts are`} waiting in Windows. Clear ${s.jobs === 1 ? 'it' : 'them'} first, so ${s.jobs === 1 ? 'it does' : 'they do'} not all print later.`]
    : [];
  if (s.offline || has(s.status, 'Offline', 'NotAvailable')) {
    return { title: 'Windows says the printer is off or not connected.', steps: [...waiting, ...CHECKS.slice(0, 2), 'Wait 10 seconds, then try again.'], clearJobs };
  }
  if (has(s.status, 'PaperOut', 'PaperProblem', 'PaperJam')) {
    return { title: 'The printer is out of paper, or the paper is stuck.', steps: [...waiting, 'Open the lid and put in a new roll, with the end coming out towards you over the top.', 'Close the lid firmly until it clicks.'], clearJobs };
  }
  if (has(s.status, 'DoorOpen')) {
    return { title: "The printer's lid is open.", steps: [...waiting, 'Close the lid firmly until it clicks.'], clearJobs };
  }
  if (has(s.status, 'Paused')) {
    return { title: 'Printing is paused in Windows.', steps: [...waiting, 'Open Windows Settings → Printers, choose this printer, and choose Resume.'], clearJobs };
  }
  if (has(s.status, 'Error', 'UserIntervention', 'OutOfMemory')) {
    return { title: 'The printer reports a problem.', steps: [...waiting, 'Turn the printer off, wait 10 seconds, turn it on again.', ...CHECKS.slice(1)], clearJobs };
  }
  if (clearJobs) {
    return { title: 'Receipts are stuck waiting for the printer.', steps: [...waiting, ...CHECKS], clearJobs };
  }
  // Many receipt printers say "ready" even when switched off: check the obvious, and the choice.
  return {
    title: 'Windows says the printer is ready, but nothing came out.',
    steps: [...CHECKS, 'The printer chosen above is your receipt printer (not another printer on this computer).'],
    clearJobs,
  };
}

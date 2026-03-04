import crypto from 'crypto';

/** Unique hash for this bot process — invalidates inline buttons from previous runs */
export const botInstanceHash = crypto.randomBytes(2).toString('hex');

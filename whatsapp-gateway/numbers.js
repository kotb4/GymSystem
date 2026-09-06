'use strict';

// Egyptian phone normalization for WhatsApp delivery (mobile only).
// Inputs may arrive as: 01012345678 / 1012345678 / 201012345678 / +201012345678
// / 00201012345678 / "010 1234 5678" / with dashes.
// Output: E.164 digit string '201012345678' or null when unparseable / not an EG mobile.
// Landlines and non-mobile forms are rejected (WhatsApp sends to mobiles only).

function digitsOnly(value) {
  return String(value == null ? '' : value).replace(/[^\d]/g, '');
}

function normalizeEgyNumber(value) {
  let d = digitsOnly(value);
  if (!d) return null;

  // Drop explicit international dialing prefixes.
  if (d.startsWith('00')) d = d.slice(2);
  // E.164 country code 20 (+ national number = 12 digits total for mobile).
  if (d.startsWith('20') && (d.length === 12 || d.length === 11)) d = d.slice(2);
  // National mobile with leading zero: 01x xxxxx xx.
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);

  // Now expect the 10-digit national mobile form 1x xxxxxxxx with valid prefix 10/11/12/15.
  if (/^1[0125]\d{8}$/.test(d)) return '20' + d;

  return null;
}

module.exports = { normalizeEgyNumber, digitsOnly };
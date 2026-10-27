// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized: the
// address of the Eco-Devices, its optional login, and what each pulse counter
// measures (water, gas or nothing) with the unit of its index. The address
// parser and the login rules come from gladys-iskra / gladys-p1-monitor
// (approved).
// -----------------------------------------------------------------------------

import { COUNTER_INPUTS } from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port. A pasted URL ("http://192.168.1.30/index.htm") is reduced
 * to its host and port.
 * @returns {{ address: string } | { error: 'invalid' }} `address` is '' when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { address: '' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent
  // around; a control byte (CR, LF...) never goes into a request.
  if (text.includes('@')) {
    return { error: 'credentials' };
  }
  if (/[\s\p{Cc}]/u.test(text)) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return withPort(`[${bracketed[1].toLowerCase()}]`, bracketed[2]);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return { address: `[${text.toLowerCase()}]` };
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2]);
}

function withPort(host, port) {
  if (port === undefined) {
    return { address: host };
  }
  const number = Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: number === 80 ? host : `${host}:${number}` };
}

/** A login part: printable, no control byte (it goes into a header), bounded. */
const LOGIN = /^[\x20-\x7e\u00a0-\uffff]{1,64}$/;

/**
 * The login of the Eco-Devices ("Accès sécurisé"): both fields or none; a
 * password without a user is refused. The user name never holds ":" (Basic
 * encoding).
 * @returns {{ username: string, password: string } | null | 'invalid'}
 */
function loginOf(raw) {
  const username = typeof raw?.username === 'string' ? raw.username.trim() : '';
  const password = typeof raw?.password === 'string' ? raw.password : '';
  if (username === '' && password === '') {
    return null;
  }
  if (
    username === '' ||
    password === '' ||
    username.includes(':') ||
    !LOGIN.test(username) ||
    !LOGIN.test(password)
  ) {
    return 'invalid';
  }
  return { username, password };
}

export const COUNTER_TYPES = ['none', 'water', 'gas'];
export const COUNTER_UNITS = ['liter', 'cubic_meter'];

/** What a pulse counter measures: `{ type, unit }`; anything else is "none" / "liter". */
function counterOf(raw, input) {
  const type = raw?.[`${input}_type`];
  const unit = raw?.[`${input}_unit`];
  return {
    type: COUNTER_TYPES.includes(type) ? type : 'none',
    unit: COUNTER_UNITS.includes(unit) ? unit : 'liter',
  };
}

export function normalizeConfig(raw = {}) {
  // An address longer than any host name is refused before any parsing.
  const value = typeof raw?.address === 'string' && raw.address.length <= 300 ? raw.address : '';
  const parsed = parseAddress(value);
  const login = loginOf(raw);
  return {
    address: parsed.error ? '' : parsed.address,
    invalidAddress:
      Boolean(parsed.error) ||
      (typeof raw?.address === 'string' && value === '' && raw.address !== ''),
    /** user:password@ pasted in the address (the wiki writes the URL so): the login fields instead. */
    credentialsInAddress: parsed.error === 'credentials',
    login: login === 'invalid' ? null : login,
    invalidLogin: login === 'invalid',
    counters: Object.fromEntries(COUNTER_INPUTS.map((input) => [input, counterOf(raw, input)])),
  };
}

/** Whether the form is complete enough to read the Eco-Devices. */
export const isComplete = (config) => Boolean(config.address) && !config.invalidLogin;

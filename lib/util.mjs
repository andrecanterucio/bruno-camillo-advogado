import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const rid = (n = 24) => crypto.randomBytes(n).toString('hex');
export const digits = (s) => String(s || '').replace(/\D/g, '');

export const CNJ_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
export function formatCnj(d) {
  const n = digits(d);
  if (n.length !== 20) return d || null;
  return `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}`;
}

const TJ = {
  '01': 'tjac', '02': 'tjal', '03': 'tjap', '04': 'tjam', '05': 'tjba', '06': 'tjce', '07': 'tjdft',
  '08': 'tjes', '09': 'tjgo', '10': 'tjma', '11': 'tjmt', '12': 'tjms', '13': 'tjmg', '14': 'tjpa',
  '15': 'tjpb', '16': 'tjpr', '17': 'tjpe', '18': 'tjpi', '19': 'tjrj', '20': 'tjrn', '21': 'tjrs',
  '22': 'tjro', '23': 'tjrr', '24': 'tjsc', '25': 'tjse', '26': 'tjsp', '27': 'tjto',
};
/** Alias do tribunal no DataJud a partir do número CNJ (J = segmento, TR = tribunal). */
export function aliasDatajud(numero) {
  const n = digits(numero);
  if (n.length !== 20) return null;
  const j = n[13];
  const tr = n.slice(14, 16);
  if (j === '3') return 'stj';
  if (j === '4') return `trf${+tr}`;
  if (j === '5') return tr === '00' ? 'tst' : `trt${+tr}`;
  if (j === '8') return TJ[tr] || null;
  return null;
}

export function parseCookies(h = '') {
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function stripHtml(s = '') {
  return String(s)
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

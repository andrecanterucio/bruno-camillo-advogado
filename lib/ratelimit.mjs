// Limite de requisições em memória (janela deslizante). Mesmo desenho do zacda-app
// (src/lib/security/rate-limit.ts): 1 instância; o contador zera a cada reinício.
const buckets = new Map();
let ultimaLimpeza = Date.now();

function limpa(agora) {
  if (agora - ultimaLimpeza < 5 * 60e3) return;
  ultimaLimpeza = agora;
  for (const mapa of buckets.values()) {
    for (const [k, ts] of mapa) if (!ts.length || agora - ts[ts.length - 1] > 60 * 60e3) mapa.delete(k);
  }
}

/** true = dentro do limite (e registra a tentativa); false = estourou. */
export function dentroDoLimite(bucket, chave, max, janelaMs) {
  const agora = Date.now();
  limpa(agora);
  let mapa = buckets.get(bucket);
  if (!mapa) buckets.set(bucket, (mapa = new Map()));
  const ts = (mapa.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (ts.length >= max) { mapa.set(chave, ts); return false; }
  ts.push(agora);
  mapa.set(chave, ts);
  return true;
}

/**
 * IP real do visitante. Só confia em cabeçalhos de proxy quando o ambiente manda
 * (TRUST_PROXY=1 atrás do Traefik/Coolify; TRUST_CLOUDFLARE=1 se houver Cloudflare).
 * O 1º item do x-forwarded-for é controlado pelo cliente; o último é o que o nosso proxy anexou.
 */
export function ipDoCliente(req) {
  if (process.env.TRUST_CLOUDFLARE === '1') {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
  }
  if (process.env.TRUST_PROXY === '1') {
    const saltos = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (saltos.length) return saltos[saltos.length - 1];
  }
  return req.socket.remoteAddress || 'desconhecido';
}

/** Política de senha (mesma do zacda-app, com mínimo de 10 por proteger dados de clientes de escritório). */
export function validaSenha(s) {
  const x = String(s || '');
  if (x.length < 10 || !/[A-Z]/.test(x) || !/[a-z]/.test(x) || !/[0-9]/.test(x) || !/[^A-Za-z0-9]/.test(x))
    return 'A senha precisa ter 10 ou mais caracteres, com maiúscula, minúscula, número e caractere especial.';
  return null;
}

/** CPF com dígitos verificadores. */
export function cpfValido(c) {
  const d = String(c || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === +d[9] && dig(10) === +d[10];
}

import { get, run, now, tx } from './db.mjs';
import { hashPassword } from './auth.mjs';

export const DEMO = {
  senha: 'demo1234',
  admin: 'bruno@demo.local',
  funcionario: 'ana@demo.local',
  cliente: 'cliente@demo.local',
};

/** Cria o primeiro admin a partir do ambiente (produção) ou dados fictícios (--demo). */
export function bootstrap({ demo }) {
  if (get('SELECT 1 x FROM users LIMIT 1')) return null;
  if (!demo) {
    const { ADMIN_EMAIL: email, ADMIN_PASSWORD: pw, ADMIN_NOME: nome } = process.env;
    if (!email || !pw) { console.warn('Nenhum usuário existe. Defina ADMIN_EMAIL e ADMIN_PASSWORD em .env.local para criar o admin.'); return null; }
    // primeiro acesso: a senha vinda do ambiente é provisória e a troca é obrigatória no 1º login (desligue com ADMIN_FORCE_CHANGE=0)
    run('INSERT INTO users(nome,email,role,senha_hash,must_change,criado_em) VALUES(?,?,?,?,?,?)', nome || 'Administrador', email, 'admin', hashPassword(pw), process.env.ADMIN_FORCE_CHANGE === '0' ? 0 : 1, now());
    return { email };
  }
  tx(() => {
    const h = hashPassword(DEMO.senha);
    const admin = run('INSERT INTO users(nome,email,role,senha_hash,criado_em) VALUES(?,?,?,?,?)', 'Bruno Camillo (demo)', DEMO.admin, 'admin', h, now()).id;
    const func = run('INSERT INTO users(nome,email,role,senha_hash,criado_em) VALUES(?,?,?,?,?)', 'Ana, assistente (demo)', DEMO.funcionario, 'funcionario', h, now()).id;
    const c1 = run('INSERT INTO clientes(nome,telefone,email,origem,status,criado_por,criado_em) VALUES(?,?,?,?,?,?,?)', 'Carlos Exemplo', '(61) 90000-0001', DEMO.cliente, 'Site', 'ativo', admin, now()).id;
    const c2 = run('INSERT INTO clientes(nome,telefone,origem,status,criado_por,criado_em) VALUES(?,?,?,?,?,?)', 'Marina Fictícia', '(61) 90000-0002', 'WhatsApp', 'ativo', admin, now()).id;
    run('INSERT INTO clientes(nome,telefone,origem,status,notas,criado_por,criado_em) VALUES(?,?,?,?,?,?,?)', 'Joana Lead', '(61) 90000-0003', 'Google', 'lead', 'Pediu orçamento de ação trabalhista.', admin, now());
    run('INSERT INTO users(nome,email,role,senha_hash,cliente_id,criado_em) VALUES(?,?,?,?,?,?)', 'Carlos Exemplo', DEMO.cliente, 'cliente', h, c1, now());

    const fase = (n) => get('SELECT id FROM fases WHERE nome=?', n).id;
    const caso = (t, cli, cnj, area, f, resp, seg = 0) => run(
      `INSERT INTO casos(titulo,cliente_id,numero_cnj,area,fase_id,segredo,responsavel_id,ordem,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      t, cli, cnj, area, fase(f), seg, resp, 0, now(), now()).id;
    const k1 = caso('Reclamação trabalhista: verbas rescisórias', c1, '0000123-45.2026.5.10.0001', 'Trabalho', 'Em andamento', admin);
    const k2 = caso('Ação de consumo: cobrança indevida', c2, '0701234-56.2026.8.07.0001', 'Civil e Consumidor', 'Aguardando decisão', func);
    caso('Inventário e partilha', c2, null, 'Família e Sucessões', 'Aguardando documentos', func, 1);
    caso('Execução penal: progressão de regime', null, null, 'Penal', 'Novo / Em análise', admin, 1);
    const k5 = caso('Recurso: contrato bancário', c1, '0709999-12.2025.8.07.0001', 'Civil e Consumidor', 'Recurso', admin);

    const and = (caso_id, data, orig, simples, aprovado, vis) => run(
      `INSERT INTO andamentos(caso_id,data,origem,texto_original,texto_simples,status,visivel_cliente,ia,criado_em) VALUES(?,?,?,?,?,?,?,?,?)`,
      caso_id, data, 'manual', orig, simples, aprovado ? 'aprovado' : 'rascunho', vis ? 1 : 0, 0, now());
    and(k1, '2026-10-02', 'Distribuído por sorteio à 1ª Vara do Trabalho de Brasília.', 'O processo foi registrado e encaminhado a um juiz. É o primeiro passo.', true, true);
    and(k1, '2026-10-20', 'Audiência una designada para 12/12/2026. Notifique-se as partes.', 'Foi marcada uma audiência para 12 de dezembro. O advogado vai preparar você para ela.', true, true);
    and(k1, '2026-11-05', 'Juntada de contestação. Vista à parte autora por 8 dias.', null, false, false);
    and(k5, '2026-10-15', 'Recurso recebido e distribuído ao relator.', 'O recurso chegou ao tribunal e foi encaminhado a um desembargador.', true, true);
    and(k2, '2026-10-28', 'Conclusos para decisão.', null, false, false);
    run('INSERT INTO prazos(caso_id,titulo,data,criado_em) VALUES(?,?,?,?)', k1, 'Manifestar sobre a contestação', new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), now());
    run('INSERT INTO prazos(caso_id,titulo,data,criado_em) VALUES(?,?,?,?)', k2, 'Juntar comprovante de pagamento', new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10), now());
  });
  return DEMO;
}

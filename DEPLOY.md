# Publicar o painel (Coolify, VPS Hostinger Brasil)

O mesmo servidor atende o site (`/`), o painel (`/login`, `/painel`) e o portal do cliente (`/portal`). Sem dependências: Node 22+ com `node:sqlite`.

## Antes de mudar qualquer coisa
O site de hoje é estático (nginx) e continua no ar até o Coolify ser trocado. Este branch (`feat/painel-gestao`) não altera o que está publicado enquanto o Coolify apontar para `feat/lp-inicial`.

## Passos no Coolify (aplicação do site do Bruno)
1. **Branch:** trocar para `feat/painel-gestao`.
2. **Build Pack:** `Dockerfile` (arquivo `/Dockerfile`). **Porta:** `3000`.
3. **Persistent Storage:** criar volume montado em `/app/data` (banco SQLite e documentos). **Sem volume, os dados se perdem a cada deploy.**
4. **Variáveis de ambiente** (marcar as chaves como secretas):

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` (atrás do Traefik) |
| `ADMIN_EMAIL` | e-mail do advogado (admin) |
| `ADMIN_PASSWORD` | senha **provisória** do primeiro acesso (a troca é obrigatória no 1º login) |
| `ADMIN_NOME` | `Bruno Camillo` |
| `ANTHROPIC_API_KEY` | chave dedicada ao painel, com limite de gasto |
| `AI_MODEL` | `claude-haiku-5-5` |
| `DJEN_OAB`, `DJEN_UF`, `DJEN_OAB_VARIANTES` | `56739`, `DF`, `,A` |
| `DATAJUD_AUTORIZADO` | `0` (não definir `DATAJUD_API_KEY` por ora) |

5. **Domínio:** manter `brunocamilloadvogado.com.br` e o redirect do `www`. HTTPS pelo Traefik.
6. **Deploy.** Conferir: `https://brunocamilloadvogado.com.br/` (site) e `/login` (painel).
7. **Backup:** em *Scheduled Tasks*, rodar todo dia `node scripts/backup.mjs` e levar `data/backups` e `data/uploads` para fora do servidor, com criptografia.

## Depois do deploy
- O admin entra com a senha provisória, troca a senha, assina o contrato de piloto e decide sobre o uso de IA.
- **Não importar dados reais antes** do contrato de piloto assinado e da revisão jurídica (ver pacote de revisão).

## Voltar atrás
Trocar o branch de volta para `feat/lp-inicial` e o Build Pack para o estático anterior. O volume `/app/data` permanece.

// Teste de e-mail: node scripts/email-test.mjs
// Envia uma mensagem de teste para ALERT_EMAIL_TO (padrão: andre.canterucio@zacda.com.br). Não imprime segredos.
import { enviaEmail, emailConfigurado } from '../lib/email.mjs';

if (!emailConfigurado()) { console.error('FALHA: BREVO_SMTP_USER e BREVO_SMTP_PASS não definidos.'); process.exit(1); }
const para = process.env.ALERT_EMAIL_TO || 'andre.canterucio@zacda.com.br';
try {
  await enviaEmail({ para, assunto: '[Painel Bruno] Teste de e-mail', texto: 'Se você leu isto, o aviso de interesse nos add-ons está funcionando.' });
  console.log(`E-mail de teste enviado para ${para}.`);
} catch (e) { console.error(`FALHA: ${e.message}`); process.exit(1); }

// Pluggable mail transport. dev='preview' writes .html to data/outbox (no network).
// prod='smtp' would use nodemailer (added at deploy). Never sends in dev.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, ROOT } from '../config.js';

export async function sendMail({ to, cc, subject, html }) {
  if (config.mailTransport === 'smtp') {
    const { sendViaSmtp } = await import('./smtp.js');
    return await sendViaSmtp({ to, cc, subject, html });
  }
  // preview transport
  const dir = resolve(ROOT, 'data/outbox');
  mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}_${String(subject || 'mail').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 40)}.html`;
  writeFileSync(resolve(dir, fname), html || '');
  return { transport: 'preview', file: fname, to, cc, subject };
}

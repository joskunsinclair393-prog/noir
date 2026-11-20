import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractStudyFiles, studyContext, DOCX_TYPE } from '../study.js';
import { createNoirServer } from '../server.js';

function pdf(text) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(out).toString('base64');
}
function docx(xml) {
  const name = Buffer.from('word/document.xml'), data = Buffer.from(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]).toString('base64');
}
const notes = { name: 'biology.txt', mimeType: 'text/plain', data: Buffer.from('Mitochondria produce ATP.').toString('base64') };

test('Study extracts actual PDF pages, DOCX paragraphs and text, rejecting unreadable or oversized materials', async () => {
  const files = await extractStudyFiles([
    { name: 'notes.pdf', mimeType: 'application/pdf', data: pdf('Photosynthesis uses sunlight.') },
    { name: 'notes.docx', mimeType: DOCX_TYPE, data: docx('<w:document><w:p><w:r><w:t>Cells &amp; energy</w:t></w:r></w:p></w:document>') },
    { name: 'notes.txt', mimeType: 'text/plain', text: 'My notes.' },
  ]);
  assert.match(files[0].text, /\[Page 1\].*Photosynthesis uses sunlight\./s);
  assert.equal(files[1].text, 'Cells & energy');
  assert.equal(files[2].text, 'My notes.');
  await assert.rejects(extractStudyFiles([{ name: 'bad.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-broken').toString('base64') }]), /could not be read/);
  await assert.rejects(extractStudyFiles([{ name: 'scan.pdf', mimeType: 'application/pdf', data: pdf('') }]), /OCR/);
  await assert.rejects(extractStudyFiles([{ name: 'bad.docx', mimeType: DOCX_TYPE, data: 'AA==' }]), /Invalid DOCX/);
  await assert.rejects(extractStudyFiles([{ name: 'huge.txt', mimeType: 'text/plain', text: 'a'.repeat(48001) }]), /48,000/);
  assert.throws(() => studyContext([], [{ name: 'large', text: 'x'.repeat(48001) }]), /48,000/);
  assert.deepEqual(studyContext([{ name: 'a', text: 'old' }], [{ name: 'a', text: 'new' }]), [{ name: 'a', text: 'new' }]);
});

test('Study uses real extracted material in the model request, retains follow-up context, isolates accounts and charges normal usage', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'noir-study-'));
  const observed = [];
  const server = createNoirServer({ dataFile: join(folder, 'store.json'),
    config: { authRequired: false, privateBetaEnabled: false, openRouterFreeKey: 'test-only', dailyTokenLimit: 10000 },
    generate: async args => { observed.push(args); return { text: 'Practice question: what produces ATP?', usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 } }; },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const boot = await fetch(base + '/api/bootstrap'); const cookie = boot.headers.get('set-cookie').split(';')[0];
  assert.equal((await boot.json()).integrations.plugins.Study.ready, true);
  const send = (body, account = cookie) => fetch(base + '/api/chat', { method: 'POST', headers: { cookie: account, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const response = await send({ message: 'Give me a practice question', plugins: ['Study'], attachments: [notes, { name: 'sun.pdf', mimeType: 'application/pdf', data: pdf('Plants use sunlight.') }] });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.session.dailyTokens, 40);
    assert.equal(result.chat.studyMaterials, undefined);
    assert.match(observed[0].instructions, /Never invent file contents/);
    assert.match(observed[0].messages.at(-1).text, /Mitochondria produce ATP/);
    assert.match(observed[0].messages.at(-1).text, /Plants use sunlight/);
    assert.equal(observed[0].messages.at(-1).attachments, undefined);
    const chatId = result.chat.id;
    assert.equal((await send({ chatId, message: 'Explain that concept', plugins: ['Study'] })).status, 200);
    assert.match(observed.at(-1).messages.at(-1).text, /Mitochondria produce ATP/);
    assert.equal((await send({ chatId, message: 'Normal chat', plugins: [] })).status, 200);
    assert.doesNotMatch(observed.at(-1).messages.at(-1).text, /Study materials/);
    const other = await fetch(base + '/api/bootstrap'); const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.equal((await send({ chatId, message: 'Read private notes', plugins: ['Study'] }, otherCookie)).status, 404);
    assert.equal((await send({ message: 'Study without materials', plugins: ['Study'] }, otherCookie)).status, 200);
    assert.doesNotMatch(observed.at(-1).messages.at(-1).text, /Mitochondria/);
    assert.equal((await send({ message: 'read', plugins: ['Study'], attachments: [{ name: 'bad.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-bad').toString('base64') }] })).status, 400);
    assert.match(readFileSync(join(folder, 'store.json'), 'utf8'), /Mitochondria produce ATP/);
    const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(markup, /data-name="Study"/); assert.match(markup, /\.docx/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(folder, { recursive: true, force: true }); }
});

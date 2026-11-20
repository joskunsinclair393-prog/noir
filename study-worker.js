import { parentPort, workerData } from 'node:worker_threads';
import { inflateRawSync } from 'node:zlib';
import { getDocumentProxy } from 'unpdf';

const MAX_TEXT = 48_000;
function docxText(bytes) {
  // Read only the main document entry; never extract paths or follow relationships.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw Error('Invalid DOCX. Export the document as DOCX or TXT and try again.');
  let offset = bytes.readUInt32LE(end + 16);
  const entries = bytes.readUInt16LE(end + 10);
  if (entries > 2000) throw Error('This DOCX contains too many entries. Export it as TXT.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      if (flags & 1 || expanded > 1024 * 1024 || ![0, 8].includes(method)) throw Error('Encrypted or oversized DOCX is unsupported. Export it as TXT.');
      const local = bytes.readUInt32LE(offset + 42);
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('Invalid DOCX entry.');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + size > bytes.length || size > 3 * 1024 * 1024) throw Error('Invalid DOCX size.');
      const packed = bytes.subarray(start, start + size);
      const xml = (method === 8 ? inflateRawSync(packed, { maxOutputLength: 1024 * 1024 }) : packed).toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unsupported document markup. Export as TXT.');
      return xml.replace(/<w:tab\b[^>]*\/>/g, ' ').replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[key]))
        .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; });
    }
    offset += 46 + nameLength + extra + comment;
  }
  throw Error('No readable document found in this DOCX.');
}

try {
  const files = [];
  let total = 0;
  for (const file of workerData) {
    let text = file.text;
    if (file.mimeType === 'application/pdf') {
      let pdf;
      try {
        pdf = await getDocumentProxy(new Uint8Array(Buffer.from(file.data, 'base64')), {
          isEvalSupported: false, useWorkerFetch: false, disableFontFace: true, maxImageSize: 0,
          isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0,
        });
        if (pdf.numPages > 60) throw Error('Study supports PDFs up to 60 pages. Split the PDF first.');
        text = '';
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          text += `\n[Page ${n}]\n` + content.items.map(item => item.str || '').join(' ');
          page.cleanup();
          if (text.length > MAX_TEXT) throw Error('The PDF has too much text. Upload a shorter excerpt.');
        }
        if (!text.replace(/\[Page \d+\]/g, '').trim()) throw Error('This PDF has no readable text. Scanned PDFs need OCR; upload a text-based PDF or TXT instead.');
      } catch (error) {
        if (/Study supports|too much text|no readable text/.test(error.message)) throw error;
        throw Error('The PDF could not be read. It may be damaged or password-protected. Export an unlocked text-based PDF.');
      } finally { await pdf?.loadingTask.destroy(); }
    } else if (file.mimeType.includes('wordprocessingml')) text = docxText(Buffer.from(file.data, 'base64'));
    if (typeof text !== 'string' || !text.trim()) throw Error('Study accepts readable PDF, DOCX and text documents. Images and empty documents are unsupported.');
    total += text.length;
    if (total > MAX_TEXT) throw Error('Study accepts up to 48,000 extracted characters. Upload a shorter excerpt.');
    files.push({ name: file.name, text: text.trim() });
  }
  parentPort.postMessage({ files });
} catch (error) { parentPort.postMessage({ error: error.message }); }

import 'server-only';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
export const MAX_FILE_SIZE = 3 * 1024 * 1024;
export const BUCKET = 'compras-gastos-privados';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function safeName(name: string, mime: string) {
  const normalized = name.normalize('NFC').trim();
  if (!normalized || normalized.length > 180 || /[\u0000-\u001f\u007f/\\<>\u202a-\u202e\u2066-\u2069]/u.test(normalized)) throw new Error('Nombre de archivo inválido.');
  const allowed = mime === 'image/jpeg' ? /\.jpe?g$/i : mime === 'image/png' ? /\.png$/i : mime === 'application/pdf' ? /\.pdf$/i : null;
  if (!allowed?.test(normalized)) throw new Error('Extensión y formato incompatibles. Usá JPG, PNG o PDF.');
  return normalized;
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(b: Buffer) {
  if (!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
  let pos = 8, header = false, data = false, ended = false; const compressed: Buffer[] = [];
  while (pos + 12 <= b.length) {
    const size = b.readUInt32BE(pos); if (size > b.length - pos - 12) return false;
    const type = b.toString('ascii',pos+4,pos+8); const chunk = b.subarray(pos+8,pos+8+size);
    if (crc32(b.subarray(pos+4,pos+8+size)) !== b.readUInt32BE(pos+8+size)) return false;
    if (!header) {
      if (type !== 'IHDR' || size !== 13) return false;
      const w=chunk.readUInt32BE(0),h=chunk.readUInt32BE(4),depth=chunk[8],color=chunk[9];
      const depths: Record<number,number[]> = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if (!w || !h || w>8192 || h>8192 || w*h>16000000 || !depths[color]?.includes(depth) || chunk[10]!==0 || chunk[11]!==0 || chunk[12]>1) return false;
      header=true;
    } else if (type === 'IHDR') return false;
    if (type==='IDAT') { data=true; compressed.push(chunk); }
    pos += 12 + size;
    if (type==='IEND') { if (size!==0 || pos!==b.length) return false; ended=true; break; }
  }
  if (!data || !ended) return false;
  try { return inflateSync(Buffer.concat(compressed),{maxOutputLength:64*1024*1024}).length>0; } catch { return false; }
}
function jpeg(b: Buffer) {
  if (b.length<20 || b[0]!==255 || b[1]!==216 || b[b.length-2]!==255 || b[b.length-1]!==217) return false;
  let pos=2,frame=false,quantization=false,huffman=false,components=0;
  while (pos+4<=b.length) {
    if (b[pos++]!==255) return false;
    while (b[pos]===255) pos++;
    const marker=b[pos++]; if (marker===216 || marker===217 || marker===0) return false;
    const length=b.readUInt16BE(pos); if (length<2 || pos+length>b.length) return false;
    if ([192,193,194].includes(marker)) {
      if (length<8) return false;
      const height=b.readUInt16BE(pos+3),width=b.readUInt16BE(pos+5); components=b[pos+7];
      if (!height || !width || width>8192 || height>8192 || width*height>16000000 || components<1 || components>4 || length!==8+3*components || b[pos+2]!==8) return false;
      frame=true;
    }
    if (marker===219) {
      let table=pos+2;
      while(table<pos+length) {const precision=b[table]>>>4;if(precision>1 || (b[table]&15)>3)return false;table+=1+64*(precision+1);}
      if(table!==pos+length)return false;quantization=true;
    }
    if (marker===196) {
      let table=pos+2;
      while(table<pos+length) {
        if(table+17>pos+length || (b[table]>>>4)>1 || (b[table]&15)>3)return false;
        let codes=0;for(let i=1;i<=16;i++)codes+=b[table+i];
        if(!codes || codes>256)return false;table+=17+codes;
      }
      if(table!==pos+length)return false;huffman=true;
    }
    if (marker===218) return frame && quantization && huffman && b[pos+2]>0 && b[pos+2]<=components && length===6+2*b[pos+2] && pos+length<b.length-2;
    pos+=length;
  }
  return false;
}
export async function validateFile(bytes: Uint8Array, mime: string, name: string) {
  if (!bytes.length || bytes.length>MAX_FILE_SIZE) throw new Error('El archivo debe tener contenido y no superar 3 MiB.');
  const normalized = safeName(name,mime); const b=Buffer.from(bytes);
  let valid=false;
  if (mime==='image/png') valid=png(b);
  if (mime==='image/jpeg') valid=jpeg(b);
  if (mime==='application/pdf' && /^%PDF-1\.[0-9]/.test(b.subarray(0,8).toString('ascii')) && /%%EOF\s*$/.test(b.subarray(-1024).toString('latin1'))) {
    try { const pdf=await PDFDocument.load(b,{updateMetadata:false}); valid=pdf.getPageCount()>0; } catch { valid=false; }
  }
  if (!valid) throw new Error('El contenido no corresponde a un JPG, PNG o PDF válido.');
  return {name:normalized,mime,size:bytes.length,hash:digest(bytes)};
}

// Gerador de .zip em fluxo (sem compressão, "store"), sem dependências e sem carregar os arquivos na memória.
// Usa data descriptor (bit 3), então o CRC e o tamanho são gravados depois de cada arquivo passar.
import zlib from 'node:zlib';

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const FLAGS = 0x0808; // bit 3 (data descriptor) + bit 11 (nomes em UTF-8)

function dosDataHora(d = new Date()) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [hora, data];
}

export class ZipStream {
  /** @param {import('node:stream').Writable} out */
  constructor(out) { this.out = out; this.pos = 0; this.entradas = []; }

  async _escreve(buf) {
    this.pos += buf.length;
    if (!this.out.write(buf)) await new Promise((res) => this.out.once('drain', res));
  }

  /** Adiciona um arquivo a partir de um Buffer ou de um iterável assíncrono de pedaços (ex.: fs.createReadStream). */
  async adiciona(nome, conteudo) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const [hora, data] = dosDataHora();
    const offset = this.pos;
    await this._escreve(Buffer.concat([u32(0x04034b50), u16(20), u16(FLAGS), u16(0), u16(hora), u16(data), u32(0), u32(0), u32(0), u16(nomeBuf.length), u16(0), nomeBuf]));
    let crc = 0, tamanho = 0;
    const pedacos = Buffer.isBuffer(conteudo) ? [conteudo] : conteudo;
    for await (const p of pedacos) {
      const b = Buffer.isBuffer(p) ? p : Buffer.from(p);
      crc = zlib.crc32(b, crc);
      tamanho += b.length;
      await this._escreve(b);
    }
    await this._escreve(Buffer.concat([u32(0x08074b50), u32(crc), u32(tamanho), u32(tamanho)]));
    this.entradas.push({ nomeBuf, crc, tamanho, offset, hora, data });
  }

  /** Grava o diretório central e termina o arquivo. */
  async fecha() {
    const inicio = this.pos;
    for (const e of this.entradas) {
      await this._escreve(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(FLAGS), u16(0), u16(e.hora), u16(e.data), u32(e.crc), u32(e.tamanho), u32(e.tamanho), u16(e.nomeBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset), e.nomeBuf]));
    }
    const tamCentral = this.pos - inicio;
    await this._escreve(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(this.entradas.length), u16(this.entradas.length), u32(tamCentral), u32(inicio), u16(0)]));
    this.out.end();
  }
}

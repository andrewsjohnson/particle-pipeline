export interface ByteSink {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
export class BlobSink implements ByteSink {
  private parts: Uint8Array<ArrayBuffer>[]=[];
  private size=0;
  private closed=false;
  maxBytes=512*1024*1024;
  async write(bytes: Uint8Array) {
    if(this.closed) throw new Error('Output is closed');
    if(this.size+bytes.byteLength>this.maxBytes) throw new Error('Download exceeds 512 MiB. Use a browser with direct file saving or reduce output size.');
    this.parts.push(new Uint8Array(bytes)); this.size+=bytes.byteLength;
  }
  async close() {this.closed=true;}
  async abort() {this.parts=[];this.size=0;this.closed=true;}
  blob(type: string) {return new Blob(this.parts,{type});}
}
export function downloadBlob(blob: Blob, name: string) {
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}

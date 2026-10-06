// Read-only snapshots + transactional writers simulate the native File System Access API.
function fakeDirectory(name = '父目录') {
  const files = new Map(), directories = new Map();
  return {name, kind:'directory', files, directories, writes:0,
    async getDirectoryHandle(name, options) {
      if (!directories.has(name) && options?.create) directories.set(name, fakeDirectory(name));
      if (!directories.has(name)) throw Object.assign(new Error('missing'),{name:'NotFoundError'});
      return directories.get(name);
    },
    async getFileHandle(name, options) {
      if (!files.has(name) && !options?.create) throw Object.assign(new Error('missing'),{name:'NotFoundError'});
      if (!files.has(name)) files.set(name,new Uint8Array());
      const directory = this;
      return {name,kind:'file', async getFile() {return new Blob([files.get(name)]);},
        async createWritable() {
          const chunks = [];
          const stream = new WritableStream({
            write(chunk) { directory.writes++; chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk); },
            async close() {files.set(name,new Uint8Array(await new Blob(chunks).arrayBuffer()));},
            abort() {chunks.length=0;}
          });
          stream.write = async chunk => { const writer = stream.getWriter(); try {await writer.write(chunk);} finally {writer.releaseLock();} };
          stream.close = async () => { const writer = stream.getWriter(); try {await writer.close();} finally {writer.releaseLock();} };
          return stream;
        }
      };
    },
    async *entries() { for (const name of [...files.keys()]) yield [name,await this.getFileHandle(name)]; for(const [name,handle] of directories)yield[name,handle]; },
    async removeEntry(name) { files.delete(name); }
  };
}
module.exports = {fakeDirectory};

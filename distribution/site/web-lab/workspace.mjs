// Isolated synthetic proof for a future browser-only MoonDog Workspace.
// Not the production filesystem authority. Never ingest real dealership data.
const NAMESPACE = 'moondog-pwa-synthetic-proof-v1';
const FORMAT = 'moondog-synthetic-opfs-proof';
const VERSION = 1;
const UUID = /^synthetic-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const fail = message => { throw new Error(message); };
const digest = async (bytes, subtle) => Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes)),
  v => v.toString(16).padStart(2, '0')).join('');

async function readBytes(dir, name) {
  const handle = await dir.getFileHandle(name);
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}
async function writeVerified(dir, name, data, subtle) {
  const bytes = encoder.encode(data);
  const file = await dir.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(bytes);
  await writer.close();
  const persisted = await readBytes(dir, name);
  if (await digest(persisted, subtle) !== await digest(bytes, subtle))
    fail('Stored bytes did not match the synthetic proof; keep the original folder for inspection.');
}
function assertStoreId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('Invalid synthetic store identifier.');
  return id;
}
async function storeDirectory(stores, id) {
  return stores.getDirectoryHandle(assertStoreId(id), { create: false });
}
async function verifiedStore(stores, id) {
  const dir = await storeDirectory(stores, id);
  const marker = JSON.parse(decoder.decode(await readBytes(dir, 'manifest.json')));
  if (marker.format !== FORMAT || marker.version !== VERSION || marker.id !== id || marker.synthetic !== true)
    fail('Synthetic store identity does not match this isolated directory.');
  return dir;
}

/** Use browser-owned storage, never Desktop permissions; synthetic-only by design. */
export async function openSyntheticLab({ storage = globalThis.navigator?.storage, subtle = globalThis.crypto?.subtle,
  uuid = () => globalThis.crypto.randomUUID() } = {}) {
  if (!storage || typeof storage.getDirectory !== 'function' || !subtle || typeof subtle.digest !== 'function')
    fail('This Edge profile does not provide the secure Origin Private File System APIs.');
  const origin = await storage.getDirectory();
  const namespace = await origin.getDirectoryHandle(NAMESPACE, { create: true });
  const stores = await namespace.getDirectoryHandle('stores', { create: true });
  return Object.freeze({
    async createStore() {
      const id = assertStoreId(`synthetic-${uuid()}`);
      try {
        await stores.getDirectoryHandle(id, { create: false });
        fail('A synthetic store with that identity already exists; no files were changed.');
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      const dir = await stores.getDirectoryHandle(id, { create: true });
      // An interrupted creation leaves a non-verified directory, never false success.
      const manifest = JSON.stringify({ format: FORMAT, version: VERSION, id, synthetic: true });
      await writeVerified(dir, 'manifest.json', manifest, subtle);
      return { id, verified: true };
    },
    async proveDurableReadback(id, payload = 'synthetic-only') {
      if (payload !== 'synthetic-only') fail('This lab refuses non-synthetic report or customer data.');
      const dir = await verifiedStore(stores, id);
      const data = JSON.stringify({ format: FORMAT, id, payload });
      await writeVerified(dir, 'proof.json', data, subtle);
      return this.readProof(id);
    },
    async readProof(id) {
      const dir = await verifiedStore(stores, id);
      const bytes = await readBytes(dir, 'proof.json');
      const proof = JSON.parse(decoder.decode(bytes));
      if (proof.format !== FORMAT || proof.id !== id || proof.payload !== 'synthetic-only')
        fail('The browser-stored proof does not belong to this store.');
      return { id, contentSha256: await digest(bytes, subtle), verified: true };
    },
    async inspectStore(id) { await verifiedStore(stores, id); return { id, verified: true }; },
    async listStoreIds() {
      const ids = [];
      for await (const [name, handle] of stores.entries()) {
        if (handle.kind === 'directory' && UUID.test(name)) ids.push(name);
      }
      return ids.sort();
    },
    async browserRetention() {
      const persisted = typeof storage.persisted === 'function' ? await storage.persisted() : false;
      const estimate = typeof storage.estimate === 'function' ? await storage.estimate() : null;
      return { persisted: persisted === true, quota: Number.isFinite(estimate?.quota) ? estimate.quota : null };
    }
  });
}

import { openSyntheticLab } from './workspace.mjs';

const status = document.getElementById('status');
const storeCount = document.getElementById('storeCount');
const create = document.getElementById('create');
const test = document.getElementById('test');
let lab = null;
let lastStore = null;

function say(message, error = false) {
  status.textContent = message;
  status.className = error ? 'status error' : 'status';
}
async function initialize() {
  try {
    lab = await openSyntheticLab();
    const retained = await lab.browserRetention();
    const stores = await lab.listStoreIds();
    storeCount.textContent = `${stores.length} synthetic store(s) in browser storage`;
    create.disabled = false;
    say(`Browser-owned storage works. Persistent storage: ${retained.persisted ? 'granted' : 'NOT guaranteed'}.
No dealership data has been touched. Clearing site data can delete these synthetic stores.`);
  } catch (error) {
    say(String(error?.message || error), true);
  }
}
create.addEventListener('click', async () => {
  create.disabled = true;
  try {
    lastStore = (await lab.createStore()).id;
    await lab.proveDurableReadback(lastStore);
    const stores = await lab.listStoreIds();
    storeCount.textContent = `${stores.length} synthetic store(s) in browser storage`;
    test.disabled = false;
    say(`Created and verified SYNTHETIC store ${lastStore}. This is NOT the MoonDog dashboard.`);
  } catch (error) { say(String(error?.message || error), true); }
  finally { create.disabled = false; }
});
test.addEventListener('click', async () => {
  try {
    const result = await lab.readProof(lastStore);
    say(`Durable SYNTHETIC readback verified for ${result.id}. SHA-256: ${result.contentSha256}`);
  } catch (error) { say(String(error?.message || error), true); }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}
initialize();

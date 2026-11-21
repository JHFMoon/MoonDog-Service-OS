import {inspectBrowserWorkspaceEnrollment} from './browser_workspace_enrollment.mjs';
/**
 * Experimental, browser-local MoonDog store identity foundation.
 * NOT a production Workspace replacement and NOT a backup.
 * No network operations, reports, settings, or dealership data are accepted.
 * The real application must not write here until migration/recovery acceptance.
 */
const BUCKET = 'MoonDog-PWA-v1';
const STORES = 'stores';
const MARKER = 'INCOMPLETE-SETUP.json';
const IDENTITY = 'STORE-IDENTITY.json';
const FORMAT = 'moondog-pwa-local-store';
const STORE_VERSION = 1;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_PARTS = ['System Files', 'Workspace'];
const WORKSPACE_DIRECTORIES = ['data', 'backups', 'imports', 'exports'];

function stop(message) { throw new Error(message); }
function notFound(error) { return error?.name === 'NotFoundError'; }
function identifier(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) stop('Invalid MoonDog web-store identifier.');
  return id.toLowerCase();
}
function labelName(value) {
  if (typeof value !== 'string') stop('A store label is required.');
  const label = value.trim();
  if (label.length < 1 || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label))
    stop('Store label must be 1–80 printable characters.');
  return label;
}
function assertStorage(storage, cryptoImpl) {
  if (typeof storage?.getDirectory !== 'function') stop('Origin-private browser storage is unavailable.');
  if (typeof cryptoImpl?.randomUUID !== 'function') stop('Secure random identifiers are unavailable.');
}
async function getStores(storage, create) {
  const root = await storage.getDirectory();
  const bucket = await root.getDirectoryHandle(BUCKET, {create});
  return bucket.getDirectoryHandle(STORES, {create});
}
async function existsDirectory(root, name) {
  try { await root.getDirectoryHandle(name, {create:false}); return true; }
  catch (error) { if (notFound(error)) return false; throw error; }
}
async function existsFile(root, name) {
  try { await root.getFileHandle(name, {create:false}); return true; }
  catch (error) { if (notFound(error)) return false; throw error; }
}
async function writeNewJson(dir, name, value) {
  if (await existsFile(dir, name)) stop('Refusing to replace an existing store record.');
  const data = JSON.stringify(value, null, 2) + '\n';
  const file = await dir.getFileHandle(name, {create:true});
  const stream = await file.createWritable({keepExistingData:false});
  try { await stream.write(data); await stream.close(); }
  catch (error) { try { await stream.abort?.(); } catch (_) {} throw error; }
  const check = await (await file.getFile()).text();
  if (check !== data) stop('Browser storage readback did not match the written store record.');
}
async function readJson(dir, name) {
  const file = await dir.getFileHandle(name, {create:false});
  const contents = await (await file.getFile()).text();
  if (contents.length > 4096) stop('Oversized browser store identity record.');
  try { return JSON.parse(contents); }
  catch (_) { return stop('Unreadable browser store identity record.'); }
}
async function locateWorkspace(store) {
  let folder = store;
  for (const part of WORKSPACE_PARTS) folder = await folder.getDirectoryHandle(part, {create:false});
  for (const directory of WORKSPACE_DIRECTORIES) await folder.getDirectoryHandle(directory, {create:false});
  return folder;
}
/**
 * Creates a completely new empty browser-local store. No existing file:// store
 * is migrated or used, and the absence of report data is NOT evidence of zero.
 */
export async function createEmptyStore({storage, crypto: cryptoImpl, label, workspaceId, enrollment}) {
  assertStorage(storage, cryptoImpl);
  const name = labelName(label);
  // Explicit enrollment is validated before any storage is allocated. Legacy
  // unenrolled records retain their prior non-operational foundation behavior.
  const enrolledRecord=enrollment===undefined?undefined:structuredClone(enrollment);
  if(enrolledRecord!==undefined){
    inspectBrowserWorkspaceEnrollment({label:name,enrollment:enrolledRecord});
    Object.freeze(enrolledRecord.store);Object.freeze(enrolledRecord);
  }
  const recoveredWorkspaceId = workspaceId === undefined ? null : identifier(workspaceId);
  const stores = await getStores(storage, true);
  let storeId;
  // A secure identifier is necessary but not by itself sufficient: refuse to
  // adopt any prior directory, even an empty one with a colliding name.
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = identifier(cryptoImpl.randomUUID());
    if (!await existsDirectory(stores, candidate) && !await existsFile(stores, candidate)) {
      storeId = candidate; break;
    }
  }
  if (!storeId) stop('Could not reserve a unique new browser store; nothing was adopted.');
  const directory = await stores.getDirectoryHandle(storeId, {create:true});
  const marker = {format:FORMAT, version:STORE_VERSION, storeId, status:'incomplete'};
  // Deliberately fail closed if setup crashes after reserving a store ID.
  await writeNewJson(directory, MARKER, marker);
  let workspace = directory;
  for (const part of WORKSPACE_PARTS) workspace = await workspace.getDirectoryHandle(part, {create:true});
  for (const part of WORKSPACE_DIRECTORIES) await workspace.getDirectoryHandle(part, {create:true});
  const identity = Object.freeze({format:FORMAT, version:STORE_VERSION, storeId, label:name,
    workspaceId:recoveredWorkspaceId ?? storeId,
    ...(enrolledRecord===undefined?{}:{enrollment:enrolledRecord})});
  await writeNewJson(directory, IDENTITY, identity);
  await locateWorkspace(directory);
  if (await existsFile(directory, MARKER)) await directory.removeEntry(MARKER);
  return {identity, store:directory};
}
/** Open only an existing, complete, specifically identified browser store. */
export async function openExistingStore({storage, storeId}) {
  if (typeof storage?.getDirectory !== 'function') stop('Origin-private browser storage is unavailable.');
  const id = identifier(storeId);
  const stores = await getStores(storage, false); // never silently create on open
  const directory = await stores.getDirectoryHandle(id, {create:false});
  if (await existsFile(directory, MARKER)) stop('MoonDog browser store setup is incomplete. Do not use as a working Workspace.');
  const identity = await readJson(directory, IDENTITY);
  if (identity?.format !== FORMAT || identity?.version !== STORE_VERSION ||
      identity?.storeId !== id || typeof identity?.label !== 'string' ||
      labelName(identity.label) !== identity.label)
    stop('Browser store identity does not match the requested store.');
  if(Object.hasOwn(identity,'enrollment'))inspectBrowserWorkspaceEnrollment(identity);
  await locateWorkspace(directory);
  // Before recovery identity was recorded, each Workspace used its own store ID.
  const workspaceId = Object.hasOwn(identity, 'workspaceId') ? identifier(identity.workspaceId) : id;
  if (Object.hasOwn(identity, 'workspaceId') && workspaceId !== identity.workspaceId)
    stop('Browser Workspace identifier is not canonical.');
  return {identity:Object.freeze({...identity,workspaceId}), store:directory};
}
/** Diagnostic only; do not interpret browser storage as a protected backup. */
export async function storageCapabilities({storage}) {
  return {
    opfsAvailable:typeof storage?.getDirectory === 'function',
    persistent:typeof storage?.persisted === 'function' ? await storage.persisted() : null,
    quota:typeof storage?.estimate === 'function' ? await storage.estimate() : null,
    externalBackupVerified:false,
    productionReady:false,
  };
}
// Storage & Configuration Layer (contracts §9). The only layer allowed to touch `node:fs`.
export { cascade, resolveCascade } from './cascade';
export { type FindDataRootOptions, findDataRoot } from './dataRoot';
export { readJson, writeJson } from './jsonStore';
export { type DataRootPaths, paths } from './paths';
export * from './repositories';
export { editTextInEditor, gitUserEmail, pathExists, readTextFile, writeTextFile } from './system';

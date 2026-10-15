// Storage & Configuration Layer (contracts §9). The only layer allowed to touch `node:fs`.
export { cascade, resolveCascade } from './cascade';
export { type FindDataRootOptions, findDataRoot } from './dataRoot';
export { type FolderMove, listFilesUnder, moveFolders, preflightMoves, readTextIfExists, removeFile } from './files';
export { CONFLICT_MARKER_RE, readJson, writeJson } from './jsonStore';
export { type DataRootPaths, paths } from './paths';
export * from './repositories';
export { listDataRootFiles, readDataRootFile, removeDataRootFile } from './scan';
export { editTextInEditor, gitUserEmail, pathExists, readTextFile, writeFileAtomic, writeTextFile } from './system';
export * from './transaction';

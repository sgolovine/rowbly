// Storage & Configuration Layer (contracts §9). The only layer allowed to touch `node:fs`.
export { cascade, resolveCascade } from './cascade';
export { type FindDataRootOptions, findDataRoot } from './dataRoot';
export { type FolderMove, listFilesUnder, moveFolders, preflightMoves, readTextIfExists, removeFile } from './files';
export * from './homeConfig';
export { CONFLICT_MARKER_RE, readJson, serializeJson, writeJson } from './jsonStore';
export * from './lock';
export { canonicalDataRoot, listPluginFiles, readPluginFile, resolvePluginFile } from './pathPolicy';
export { type DataRootPaths, paths } from './paths';
export * from './repositories';
export { listDataRootFiles, readDataRootFile, removeDataRootFile } from './scan';
export { editTextInEditor, pathExists, readTextFile, writeFileAtomic, writeTextFile } from './system';
export * from './transaction';

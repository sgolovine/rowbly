// Storage & Configuration Layer (contracts §9). The only layer allowed to touch `node:fs`.
export { cascade, resolveCascade, resolveGlobal } from './cascade';
export {
  assertNoRootEnv,
  canonicalDataRootPath,
  deleteDataRoot,
  type FindDataRootOptions,
  findDataRoot,
  forgetDataRoot,
  listKnownDataRoots,
  type RegisterDataRootOptions,
  recordOpenedDataRoot,
  registerDataRoot,
} from './dataRoot';
export { type FolderMove, listFilesUnder, moveFolders, preflightMoves, readTextIfExists, removeFile } from './files';
export * from './homeConfig';
export { CONFLICT_MARKER_RE, readJson, serializeJson, writeJson } from './jsonStore';
export * from './lock';
export {
  canonicalDataRoot,
  listPluginFiles,
  readPluginBinaryFile,
  readPluginFile,
  resolvePluginFile,
} from './pathPolicy';
export { type DataRootPaths, paths } from './paths';
export * from './repositories';
export { listDataRootFiles, readDataRootFile, removeDataRootFile } from './scan';
export {
  assertSkillPath,
  copyFolder,
  createFolder,
  isFolder,
  listFoldersWith,
  packagePath,
  readPackageFile,
  refreshSkillReference,
  removeSkillFolder,
  replaceSkillFolder,
} from './skills';
export { editTextInEditor, pathExists, readTextFile, writeFileAtomic, writeTextFile } from './system';
export * from './transaction';
export { isWatchedPath, type WatchDataRootOptions, watchDataRoot } from './watch';

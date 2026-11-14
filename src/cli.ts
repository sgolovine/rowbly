// The bootstrap entry of Rowbly. Node compiles all static imports before the code of a module runs, so this
// file turns on the compile cache first and then loads the CLI with a dynamic import. Keep its static imports
// to `node:` built-ins and the compile cache module.
import { enableRowblyCompileCache } from "./services/compile-cache/compile-cache.js";

enableRowblyCompileCache();

await import("./cli-main.js");

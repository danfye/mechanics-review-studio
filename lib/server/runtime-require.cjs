const path = require("node:path");
const { createRequire } = require("node:module");

function candidateModuleRoots(projectRoot) {
  const roots = [path.join(projectRoot, "node_modules")];
  if (process.env.NODE_REPL_NODE_MODULE_DIRS) {
    roots.push(...process.env.NODE_REPL_NODE_MODULE_DIRS.split(path.delimiter).filter(Boolean));
  }
  roots.push("/Users/shanfengye/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
  return [...new Set(roots)];
}

function createRuntimeRequire(projectRoot) {
  const candidates = candidateModuleRoots(projectRoot).map((nodeModulesPath) => {
    return {
      nodeModulesPath,
      require: createRequire(path.join(nodeModulesPath, "runtime.js")),
    };
  });

  function runtimeRequire(moduleName) {
    const errors = [];
    for (const candidate of candidates) {
      try {
        return candidate.require(moduleName);
      } catch (error) {
        errors.push(`${candidate.nodeModulesPath}: ${error.message}`);
      }
    }
    const hint = "请先在项目目录运行 npm install，或使用 npm run package:share 生成体验包。";
    const error = new Error(`缺少运行依赖 ${moduleName}。${hint}\n${errors.join("\n")}`);
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }

  runtimeRequire.resolve = function resolveRuntimeModule(moduleName) {
    const errors = [];
    for (const candidate of candidates) {
      try {
        return candidate.require.resolve(moduleName);
      } catch (error) {
        errors.push(`${candidate.nodeModulesPath}: ${error.message}`);
      }
    }
    const hint = "请先在项目目录运行 npm install，或使用 npm run package:share 生成体验包。";
    const error = new Error(`缺少运行依赖 ${moduleName}。${hint}\n${errors.join("\n")}`);
    error.code = "MODULE_NOT_FOUND";
    throw error;
  };

  runtimeRequire.moduleRoots = candidates.map((candidate) => candidate.nodeModulesPath);
  return runtimeRequire;
}

module.exports = {
  createRuntimeRequire,
};

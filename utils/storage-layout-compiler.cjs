// Compile in a bounded child process; only return layouts for matching historical code.
const fs = require('node:fs');
const wrapper = require('solc/wrapper');
const matchesRuntime = require('./storage-runtime.cjs');
const mappingAssignments = require('./storage-mappings.cjs');
const compiler = wrapper(require(process.argv[2]));
if (compiler.version().split('.Emscripten')[0] !== process.argv[3]) process.exit(1);
const { input, contractName, fileName, runtime } = JSON.parse(fs.readFileSync(0, 'utf8'));
// Blockscout also returns libraries as file:library -> address.
const libraries = {};
for (const [key, value] of Object.entries(input.settings.libraries ?? {})) {
  if (typeof value === 'string') {
    const separator = key.lastIndexOf(':');
    if (separator < 0) process.exit(1);
    const file = key.slice(0, separator);
    libraries[file] ??= {};
    libraries[file][key.slice(separator + 1)] = value;
  } else libraries[key] = value;
}
input.settings.libraries = libraries;
function compile() {
  const output = JSON.parse(compiler.compile(JSON.stringify(input)));
  if (output.errors?.some((error) => error.severity === 'error')) process.exit(1);
  return output;
}
function verified(output) {
  for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
    if (fileName && file !== fileName) continue;
    const candidate = contracts[contractName];
    if (!candidate || !matchesRuntime(candidate.evm.deployedBytecode, runtime)) continue;
    const contract = output.sources[file].ast.nodes.find(
      (node) => node.nodeType === 'ContractDefinition' && node.name === contractName,
    );
    return {
      layout: { ...candidate.storageLayout, types: candidate.storageLayout.types ?? {} },
      mappings: mappingAssignments(input, output, contract, compiler),
    };
  }
  return null;
}
let result = verified(compile());
// Some deployments linked after compilation. Preserve their original metadata by compiling unlinked.
if (!result && Object.keys(libraries).length) {
  input.settings.libraries = {};
  result = verified(compile());
}
process.stdout.write(JSON.stringify(result));

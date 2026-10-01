// Compile in a bounded child process; only return layouts for matching historical code.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import wrapper from 'solc/wrapper.js';
import mappingAssignments from './storage-mappings.js';
import matchesRuntime from './storage-runtime.js';

// soljson is a downloaded CommonJS compiler; our handwritten modules use ESM.
const require = createRequire(import.meta.url);
const [compilerPath, expectedCompilerVersion] = process.argv.slice(2);
const compiler = wrapper(require(compilerPath));
if (compiler.version().split('.Emscripten')[0] !== expectedCompilerVersion) process.exit(1);
const { input, contractName, fileName, runtime } = JSON.parse(readFileSync(0, 'utf8'));

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
const compilerInput = { ...input, settings: { ...input.settings, libraries } };

function compile(compilerInput) {
  const output = JSON.parse(compiler.compile(JSON.stringify(compilerInput)));
  if (output.errors?.some((error) => error.severity === 'error')) process.exit(1);
  return output;
}

function findVerifiedLayout(output, compilerInput, unlinkedOutput = output) {
  for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
    if (fileName && file !== fileName) continue;
    const compiledContract = contracts[contractName];
    if (!compiledContract || !matchesRuntime(compiledContract.evm.deployedBytecode, runtime))
      continue;
    const contractAst = output.sources[file].ast.nodes.find(
      (node) => node.nodeType === 'ContractDefinition' && node.name === contractName,
    );
    // The unlinked output identifies libraries actually used by this contract. Compiler settings
    // can also name unused libraries, which must not authorize additional delegate-call code.
    const declaredLinks =
      unlinkedOutput.contracts[file][contractName].evm.deployedBytecode.linkReferences ?? {};
    const linkedLibraryAddresses = new Set();
    for (const [libraryFile, fileLibraries] of Object.entries(declaredLinks)) {
      for (const [libraryName, locations] of Object.entries(fileLibraries)) {
        const configuredAddress = compilerInput.settings.libraries[libraryFile]?.[libraryName];
        if (configuredAddress) {
          linkedLibraryAddresses.add(configuredAddress);
          continue;
        }
        const runtimeAddresses = locations.map(
          ({ start, length }) => `0x${runtime.slice(2 + start * 2, 2 + (start + length) * 2)}`,
        );
        for (const address of runtimeAddresses) linkedLibraryAddresses.add(address);
      }
    }
    return {
      linkedLibraryAddresses: [...linkedLibraryAddresses].map((address) => address.toLowerCase()),
      layout: {
        ...compiledContract.storageLayout,
        types: compiledContract.storageLayout.types ?? {},
      },
      mappings: mappingAssignments(compilerInput, output, contractAst, compiler),
    };
  }
  return null;
}

// Unlinked output retains the actual library references and matches deployments linked afterward.
const unlinkedInput = { ...compilerInput, settings: { ...compilerInput.settings, libraries: {} } };
const unlinkedOutput = compile(unlinkedInput);
let verifiedLayout = findVerifiedLayout(unlinkedOutput, unlinkedInput);
// Deployments linked during compilation include library settings in their metadata.
if (!verifiedLayout && Object.keys(libraries).length) {
  verifiedLayout = findVerifiedLayout(compile(compilerInput), compilerInput, unlinkedOutput);
}
process.stdout.write(JSON.stringify(verifiedLayout));

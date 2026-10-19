// Post-compilation linking preserves metadata. Only compiler-declared links and immutables vary.
// Explorer-verified flattened source can lose the original metadata hash. For storage
// encoding only, permit that hash to differ in these canonical Solidity CBOR trailers.
// Every executable byte, compiler version, CBOR key, length and link rule still must match.
function normalizeSourceHash(code) {
  return code.replace(
    /(a265627a7a72315820|a2646970667358221220)([0-9a-f]{64})(64736f6c6343[0-9a-f]{6})(0032|0033)$/,
    (trailer, prefix, hash, compiler, length) => {
      if (Number.parseInt(length, 16) * 2 + 4 !== trailer.length) return trailer;
      return prefix + '0'.repeat(hash.length) + compiler + length;
    },
  );
}

export default function matchesRuntime(bytecode, runtime, allowSourceHashMismatch = false) {
  let compiledCode = bytecode.object.toLowerCase();
  let deployedCode = runtime.slice(2).toLowerCase();
  if (allowSourceHashMismatch) {
    compiledCode = normalizeSourceHash(compiledCode);
    deployedCode = normalizeSourceHash(deployedCode);
  }
  if (compiledCode.length !== deployedCode.length) return false;

  // Keep each library's locations together: every occurrence must use the same address.
  const libraryReferences = Object.values(bytecode.linkReferences ?? {}).flatMap(Object.values);
  for (const references of libraryReferences) {
    const addresses = new Set(
      references.map(({ start, length }) => deployedCode.slice(start * 2, (start + length) * 2)),
    );
    if (addresses.size !== 1 || references.some(({ length }) => length !== 20)) return false;
    const [libraryAddress] = addresses;
    for (const { start, length } of references) {
      const startIndex = start * 2;
      const endIndex = (start + length) * 2;
      if (start < 0 || endIndex > compiledCode.length) return false;
      compiledCode =
        compiledCode.slice(0, startIndex) + libraryAddress + compiledCode.slice(endIndex);
    }
  }
  if (!/^[0-9a-f]+$/.test(compiledCode)) return false;

  // Compare all bytes between constructor-set immutable ranges, including metadata.
  const immutableRanges = Object.values(bytecode.immutableReferences ?? {})
    .flat()
    .sort((a, b) => a.start - b.start);
  let comparedUntil = 0;
  for (const { start, length } of immutableRanges) {
    const startIndex = start * 2;
    const endIndex = (start + length) * 2;
    if (
      startIndex < comparedUntil ||
      endIndex > compiledCode.length ||
      compiledCode.slice(comparedUntil, startIndex) !==
        deployedCode.slice(comparedUntil, startIndex)
    )
      return false;
    comparedUntil = endIndex;
  }
  return compiledCode.slice(comparedUntil) === deployedCode.slice(comparedUntil);
}

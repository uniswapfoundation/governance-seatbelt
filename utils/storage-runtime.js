// Post-compilation linking preserves metadata. Only compiler-declared links and immutables vary.
export default function matchesRuntime(bytecode, runtime) {
  let compiledCode = bytecode.object.toLowerCase();
  const deployedCode = runtime.slice(2).toLowerCase();
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

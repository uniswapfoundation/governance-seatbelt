// Post-compilation linking preserves metadata. Only compiler-declared links and immutables vary.
module.exports = function matchesRuntime(bytecode, runtime) {
  let compiled = bytecode.object.toLowerCase();
  const deployed = runtime.slice(2).toLowerCase();
  if (compiled.length !== deployed.length) return false;
  for (const libraries of Object.values(bytecode.linkReferences ?? {})) {
    for (const references of Object.values(libraries)) {
      const addresses = new Set(
        references.map(({ start, length }) => deployed.slice(start * 2, (start + length) * 2)),
      );
      if (addresses.size !== 1 || references.some(({ length }) => length !== 20)) return false;
      for (const { start, length } of references) {
        if (start < 0 || (start + length) * 2 > compiled.length) return false;
        compiled =
          compiled.slice(0, start * 2) + [...addresses][0] + compiled.slice((start + length) * 2);
      }
    }
  }
  if (!/^[0-9a-f]+$/.test(compiled)) return false;
  let end = 0;
  for (const { start, length } of Object.values(bytecode.immutableReferences ?? {})
    .flat()
    .sort((a, b) => a.start - b.start)) {
    const next = (start + length) * 2;
    if (
      start * 2 < end ||
      next > compiled.length ||
      compiled.slice(end, start * 2) !== deployed.slice(end, start * 2)
    )
      return false;
    end = next;
  }
  return compiled.slice(end) === deployed.slice(end);
};

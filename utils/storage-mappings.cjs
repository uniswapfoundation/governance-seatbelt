// Recognize direct parameter assignments to namespaced mappings. Unsupported patterns stay raw.
const { keccak256 } = require('viem');

function nodes(value) {
  if (!value || typeof value !== 'object') return [];
  return [...(value.nodeType ? [value] : []), ...Object.values(value).flatMap(nodes)];
}

function namespaceSlot(node, byId) {
  if (node?.kind === 'typeConversion' && node.arguments.length === 1)
    return namespaceSlot(node.arguments[0], byId);
  if (node?.nodeType === 'Identifier') {
    const declaration = byId.get(node.referencedDeclaration);
    if (declaration?.constant) return namespaceSlot(declaration.value, byId);
  }
  if (
    node?.nodeType === 'BinaryOperation' &&
    node.operator === '-' &&
    node.rightExpression.value === '1'
  ) {
    const base = namespaceSlot(node.leftExpression, byId);
    return base ? { ...base, slot: base.slot - 1n } : null;
  }
  if (node?.expression?.name === 'keccak256' && node.arguments?.[0]?.kind === 'string') {
    const literal = node.arguments[0];
    return { namespace: literal.value, slot: BigInt(keccak256(`0x${literal.hexValue}`)) };
  }
  return null;
}

/** A pure getter must assign one constant slot to its returned mapping, with no other work. */
function mappingGetter(getter, byId) {
  const returns = getter.returnParameters.parameters;
  const statements = getter.body?.statements;
  if (
    getter.stateMutability !== 'pure' ||
    getter.virtual ||
    getter.modifiers.length ||
    getter.parameters.parameters.length ||
    returns.length !== 1 ||
    returns[0].storageLocation !== 'storage' ||
    returns[0].typeName.nodeType !== 'Mapping' ||
    statements?.length !== 2
  )
    return null;
  const [declaration, assembly] = statements;
  const assignments = assembly.AST?.statements;
  if (
    declaration.nodeType !== 'VariableDeclarationStatement' ||
    declaration.declarations.length !== 1 ||
    assignments?.length !== 1 ||
    assignments[0].nodeType !== 'YulAssignment' ||
    assignments[0].variableNames.length !== 1
  )
    return null;
  const write = assignments[0];
  const references = assembly.externalReferences;
  const assignsReturnedSlot = references.some(
    (ref) =>
      ref.src === write.variableNames[0].src && ref.isSlot && ref.declaration === returns[0].id,
  );
  const readsDeclaredConstant = references.some(
    (ref) =>
      ref.src === write.value.src &&
      !ref.isSlot &&
      ref.declaration === declaration.declarations[0].id,
  );
  if (!assignsReturnedSlot || !readsDeclaredConstant) return null;
  const base = namespaceSlot(declaration.initialValue, byId);
  return base
    ? {
        ...base,
        keyType: returns[0].typeName.keyType.name,
        valueType: returns[0].typeName.valueType,
      }
    : null;
}

/** Let the same compiler derive struct packing instead of maintaining offsets ourselves. */
function valueLayout(valueType, input, output, byId, compiler) {
  if (valueType.name === 'bytes32')
    return {
      storage: [{ slot: '0', offset: 0, type: 'bytes32', label: '' }],
      types: { bytes32: { encoding: 'inplace', label: 'bytes32', numberOfBytes: '32' } },
    };
  const struct = byId.get(valueType.referencedDeclaration);
  const scope = byId.get(struct?.scope);
  if (struct?.nodeType !== 'StructDefinition' || scope?.nodeType !== 'ContractDefinition')
    return null;
  const file = Object.entries(output.sources).find(
    ([, entry]) => entry.id === Number(struct.src.split(':')[2]),
  )?.[0];
  if (!file) return null;
  const probeInput = structuredClone(input);
  probeInput.sources['SeatbeltLayoutProbe.sol'] = {
    content: `pragma solidity ${compiler.version().split('+')[0]}; import {${scope.name}} from ${JSON.stringify(file)}; contract SeatbeltLayoutProbe { ${scope.name}.${struct.name} value; }`,
  };
  probeInput.settings.outputSelection = { '*': { '*': ['storageLayout'] } };
  const probe = JSON.parse(compiler.compile(JSON.stringify(probeInput)));
  if (probe.errors?.some((error) => error.severity === 'error')) return null;
  const layout = probe.contracts['SeatbeltLayoutProbe.sol'].SeatbeltLayoutProbe.storageLayout;
  return { storage: layout.types[layout.storage[0].type].members, types: layout.types };
}

function changedIdentifiers(body) {
  const changed = new Set();
  for (const node of body) {
    let target;
    if (node.nodeType === 'Assignment') target = node.leftHandSide;
    if (node.nodeType === 'UnaryOperation' && ['++', '--', 'delete'].includes(node.operator))
      target = node.subExpression;
    if (target?.nodeType === 'Identifier') changed.add(target.referencedDeclaration);
  }
  return changed;
}

/** Only getter()[keyParameter] = valueParameter, optionally selecting one struct member. */
function mappingAssignment(assignment, fn, mappings, changed) {
  if (assignment.nodeType !== 'Assignment' || assignment.operator !== '=') return null;
  const member =
    assignment.leftHandSide.nodeType === 'MemberAccess' ? assignment.leftHandSide.memberName : null;
  const left = member ? assignment.leftHandSide.expression : assignment.leftHandSide;
  if (
    left.nodeType !== 'IndexAccess' ||
    left.baseExpression.nodeType !== 'FunctionCall' ||
    left.baseExpression.arguments.length ||
    left.indexExpression.nodeType !== 'Identifier' ||
    assignment.rightHandSide.nodeType !== 'Identifier'
  )
    return null;
  const mapping = mappings.get(left.baseExpression.expression.referencedDeclaration);
  const parameters = fn.parameters.parameters;
  const inputTypes = parameters.map((parameter) => parameter.typeName?.name);
  const keyIndex = parameters.findIndex(
    (parameter) => parameter.id === left.indexExpression.referencedDeclaration,
  );
  const valueIndex = parameters.findIndex(
    (parameter) => parameter.id === assignment.rightHandSide.referencedDeclaration,
  );
  if (
    !mapping ||
    keyIndex < 0 ||
    valueIndex < 0 ||
    mapping.keyType !== inputTypes[keyIndex] ||
    !inputTypes.every((type) => /^(uint\d+|bytes32|address)$/.test(type)) ||
    changed.has(parameters[keyIndex].id) ||
    changed.has(parameters[valueIndex].id)
  )
    return null;
  const field = mapping.layout.storage.find((field) =>
    member ? field.label === member : !field.label,
  );
  const type = field && mapping.layout.types[field.type];
  if (
    !type ||
    type.encoding !== 'inplace' ||
    type.members ||
    !/^(bytes32|uint\d+)$/.test(type.label) ||
    type.label !== inputTypes[valueIndex]
  )
    return null;
  return {
    selector: fn.functionSelector,
    inputTypes,
    keyIndex,
    valueIndex,
    baseSlot: mapping.slot.toString(),
    name: mapping.namespace.split('.').at(-1),
    field,
    type,
  };
}

module.exports = function mappingAssignments(input, output, contract, compiler) {
  const ast = nodes(output.sources);
  const byId = new Map(ast.filter((node) => node.id !== undefined).map((node) => [node.id, node]));
  const activeContracts = new Set(contract.linearizedBaseContracts);
  const functions = ast.filter(
    (node) => node.nodeType === 'FunctionDefinition' && activeContracts.has(node.scope),
  );
  const mappings = new Map();
  for (const getter of functions) {
    const mapping = mappingGetter(getter, byId);
    if (!mapping) continue;
    const layout = valueLayout(mapping.valueType, input, output, byId, compiler);
    if (layout) mappings.set(getter.id, { ...mapping, layout });
  }
  const assignments = [];
  const selectors = new Set();
  for (const scope of contract.linearizedBaseContracts) {
    for (const fn of functions.filter((fn) => fn.scope === scope && fn.functionSelector)) {
      if (selectors.has(fn.functionSelector)) continue;
      selectors.add(fn.functionSelector);
      if (!fn.body) continue;
      const body = nodes(fn.body);
      const changed = changedIdentifiers(body);
      for (const node of body) {
        const assignment = mappingAssignment(node, fn, mappings, changed);
        if (assignment) assignments.push(assignment);
      }
    }
  }
  return assignments;
};

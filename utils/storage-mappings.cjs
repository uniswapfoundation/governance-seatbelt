// Recognize direct parameter assignments to namespaced mappings. Unsupported patterns stay raw.
const { keccak256 } = require('viem');
module.exports = function mappingAssignments(input, output, contract, compiler) {
  function nodes(value) {
    if (!value || typeof value !== 'object') return [];
    return [...(value.nodeType ? [value] : []), ...Object.values(value).flatMap(nodes)];
  }
  const ast = nodes(output.sources);

  const activeContracts = new Set(contract.linearizedBaseContracts);
  const functions = ast.filter(
    (node) => node.nodeType === 'FunctionDefinition' && activeContracts.has(node.scope),
  );
  const byId = new Map(ast.filter((node) => node.id !== undefined).map((node) => [node.id, node]));
  function constant(node) {
    if (node?.kind === 'typeConversion' && node.arguments.length === 1)
      return constant(node.arguments[0]);
    if (node?.nodeType === 'Identifier') {
      const declaration = byId.get(node.referencedDeclaration);
      if (declaration?.constant) return constant(declaration.value);
    }
    if (
      node?.nodeType === 'BinaryOperation' &&
      node.operator === '-' &&
      node.rightExpression.value === '1'
    ) {
      const left = constant(node.leftExpression);
      return left ? { ...left, slot: left.slot - 1n } : null;
    }
    if (node?.expression?.name === 'keccak256' && node.arguments?.[0]?.kind === 'string') {
      const literal = node.arguments[0];
      return { namespace: literal.value, slot: BigInt(keccak256(`0x${literal.hexValue}`)) };
    }
    return null;
  }
  // Recognize one precise pattern: a pure getter assigns a constant to a returned mapping's .slot.
  const mappings = new Map();
  for (const getter of functions) {
    const returns = getter.returnParameters.parameters;
    const statements = getter.body?.statements;
    if (
      getter.stateMutability !== 'pure' ||
      getter.virtual ||
      getter.parameters.parameters.length ||
      getter.modifiers.length ||
      returns.length !== 1 ||
      returns[0].storageLocation !== 'storage' ||
      returns[0].typeName.nodeType !== 'Mapping' ||
      statements?.length !== 2
    )
      continue;
    const [declaration, assembly] = statements;
    const assignments = assembly.AST?.statements;
    if (
      declaration.nodeType !== 'VariableDeclarationStatement' ||
      declaration.declarations.length !== 1 ||
      assignments?.length !== 1 ||
      assignments[0].nodeType !== 'YulAssignment' ||
      assignments[0].variableNames.length !== 1
    )
      continue;
    const write = assignments[0];
    const references = assembly.externalReferences;
    if (
      !references.some(
        (ref) =>
          ref.src === write.variableNames[0].src && ref.isSlot && ref.declaration === returns[0].id,
      ) ||
      !references.some(
        (ref) =>
          ref.src === write.value.src &&
          !ref.isSlot &&
          ref.declaration === declaration.declarations[0].id,
      )
    )
      continue;
    const base = constant(declaration.initialValue);
    if (!base) continue;
    const valueType = returns[0].typeName.valueType;
    let layout;
    if (valueType.name === 'bytes32') {
      layout = {
        storage: [{ slot: '0', offset: 0, type: 'bytes32', label: '' }],
        types: { bytes32: { encoding: 'inplace', label: 'bytes32', numberOfBytes: '32' } },
      };
    } else {
      const struct = byId.get(valueType.referencedDeclaration);
      const scope = byId.get(struct?.scope);
      if (struct?.nodeType !== 'StructDefinition' || scope?.nodeType !== 'ContractDefinition')
        continue;
      const file = Object.entries(output.sources).find(
        ([, entry]) => entry.id === Number(struct.src.split(':')[2]),
      )?.[0];
      if (!file) continue;
      const probeInput = structuredClone(input);
      probeInput.sources['SeatbeltLayoutProbe.sol'] = {
        content: `pragma solidity ${compiler.version().split('+')[0]}; import {${scope.name}} from ${JSON.stringify(file)}; contract SeatbeltLayoutProbe { ${scope.name}.${struct.name} value; }`,
      };
      probeInput.settings.outputSelection = { '*': { '*': ['storageLayout'] } };
      const probe = JSON.parse(compiler.compile(JSON.stringify(probeInput)));
      if (probe.errors?.some((error) => error.severity === 'error')) continue;
      const result = probe.contracts['SeatbeltLayoutProbe.sol'].SeatbeltLayoutProbe.storageLayout;
      const members = result.types[result.storage[0].type].members;
      layout = { storage: members, types: result.types };
    }
    mappings.set(getter.id, { ...base, keyType: returns[0].typeName.keyType.name, layout });
  }

  const assignments = [];
  const selectors = new Set();
  for (const scope of contract.linearizedBaseContracts) {
    for (const fn of functions.filter((fn) => fn.scope === scope && fn.functionSelector)) {
      if (selectors.has(fn.functionSelector)) continue;
      selectors.add(fn.functionSelector);
      if (!fn.body) continue;
      const parameters = fn.parameters.parameters;
      const inputTypes = parameters.map((parameter) => parameter.typeName?.name);
      if (!inputTypes.every((type) => /^(uint\d+|bytes32|address)$/.test(type))) continue;
      const body = nodes(fn.body);
      const mutated = new Set(
        body.flatMap((node) => {
          const target =
            node.nodeType === 'Assignment'
              ? node.leftHandSide
              : node.nodeType === 'UnaryOperation' && ['++', '--', 'delete'].includes(node.operator)
                ? node.subExpression
                : null;
          return target?.nodeType === 'Identifier' ? [target.referencedDeclaration] : [];
        }),
      );
      for (const assignment of body.filter(
        (node) => node.nodeType === 'Assignment' && node.operator === '=',
      )) {
        const member =
          assignment.leftHandSide.nodeType === 'MemberAccess'
            ? assignment.leftHandSide.memberName
            : null;
        const left = member ? assignment.leftHandSide.expression : assignment.leftHandSide;
        if (
          left.nodeType !== 'IndexAccess' ||
          left.baseExpression.nodeType !== 'FunctionCall' ||
          left.baseExpression.arguments.length ||
          left.indexExpression.nodeType !== 'Identifier' ||
          assignment.rightHandSide.nodeType !== 'Identifier'
        )
          continue;
        const mapping = mappings.get(left.baseExpression.expression.referencedDeclaration);
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
          mutated.has(parameters[keyIndex].id) ||
          mutated.has(parameters[valueIndex].id)
        )
          continue;
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
          continue;
        assignments.push({
          selector: fn.functionSelector,
          inputTypes,
          keyIndex,
          valueIndex,
          baseSlot: mapping.slot.toString(),
          name: mapping.namespace.split('.').at(-1),
          field,
          type,
        });
      }
    }
  }
  return assignments;
};

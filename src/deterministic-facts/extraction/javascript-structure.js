import { fullAncestor } from "acorn-walk";

const functions = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const classes = new Set(["ClassDeclaration", "ClassExpression"]);

function declaredName(node, ancestors) {
  if (node.id?.name) return node.id.name;
  const enclosing = ancestors.at(-2);
  if (enclosing?.type === "VariableDeclarator" && enclosing.init === node && enclosing.id.type === "Identifier") return enclosing.id.name;
  if (["MethodDefinition", "PropertyDefinition", "Property"].includes(enclosing?.type) && !enclosing.computed) {
    return enclosing.key.type === "PrivateIdentifier" ? `#${enclosing.key.name}` : enclosing.key.name ?? String(enclosing.key.value ?? "");
  }
  return null;
}

// Only @2 calls this pass. Parent links follow parser ancestors, never name,
// byte proximity, business meaning, or a guessed runtime receiver.
export function extractJavaScriptStructure({ ast, material, text, textAnchor, addObject, addFact, functionByNode }) {
  const descriptors = [];
  fullAncestor(ast, (node, _state, ancestors) => {
    if (functions.has(node.type) || classes.has(node.type) || node.type === "ImportDeclaration") descriptors.push({ node, ancestors: [...ancestors] });
  });
  descriptors.sort((a, b) => a.ancestors.length - b.ancestors.length || a.node.start - b.node.start);
  const byNode = new Map(functionByNode);
  for (const { node, ancestors } of descriptors) {
    const isImport = node.type === "ImportDeclaration", name = isImport ? node.source.value : declaredName(node, ancestors);
    const enclosing = ancestors.at(-2);
    const position = enclosing?.type === "VariableDeclarator" && enclosing.init === node ? enclosing : node;
    const object = byNode.get(node) ?? addObject(material, isImport ? "IMPORT" : classes.has(node.type) ? "JAVASCRIPT_CLASS" : "FUNCTION",
      name ?? (classes.has(node.type) ? "[anonymous class]" : "[anonymous function]"), textAnchor(text, position.start, position.end));
    const parent = [...ancestors].reverse().map(candidate => byNode.get(candidate)).find(candidate => candidate && candidate.objectId !== object.objectId) ?? material.root;
    object.parentId = parent.objectId;
    byNode.set(node, object);
    if (functions.has(node.type)) functionByNode.set(node, object);
    if (typeof name === "string" && name.length) {
      addFact({ subject: object, predicate: "name", value: { datatype: "string", value: name }, material, anchor: object.anchor });
      addFact({ subject: parent, predicate: isImport ? "imports" : "declares", target: object, material, anchor: object.anchor });
    }
  }
}

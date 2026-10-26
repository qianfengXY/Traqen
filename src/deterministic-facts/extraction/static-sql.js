import { isSensitiveKey } from "../sensitive-content.js";

// A deliberately small lexer, not a SQL executor or dialect/type resolver.
// Strings/comments are single tokens, so their contents can never become table names.
function tokens(text, limit) {
  const result = [];
  const expression = /\s+|--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][\w$]*|\$\d+|\d+(?:\.\d+)?|[(),;.*=?<>!+/-]/gy;
  let offset = 0;
  while (offset < text.length) {
    expression.lastIndex = offset;
    const match = expression.exec(text);
    if (!match) return null;
    offset = expression.lastIndex;
    if (/^\s|^--|^\/\*/.test(match[0])) continue;
    if (result.length >= limit) return null;
    result.push({ text: match[0], start: match.index, end: offset });
  }
  return result;
}
const reserved = new Set(["IF", "NOT", "EXISTS", "ONLY", "SELECT", "FROM", "INTO", "WHERE", "SET", "VALUES", "TABLE", "CREATE", "UPDATE", "DELETE", "INSERT", "JOIN", "AS", "TEMP", "TEMPORARY", "UNLOGGED", "LIKE", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"]);
const identifier = token => token && ((/^[A-Za-z_][\w$]*$/.test(token.text) && !reserved.has(token.text.toUpperCase())) || /^"(?:""|[^"])+"$/.test(token.text));
const label = token => token.text.startsWith('"') ? token.text.slice(1, -1).replaceAll('""', '"') : token.text;

export function extractStaticSql({ text, material, objectMaterial = material, embedded = false, anchorFor, addObject, addFact, addGap, limits, sqlReferences }) {
  const all = tokens(text, limits.maxSqlTokens ?? 20_000);
  if (!all) { addGap(material, "sql", "SQL_SYNTAX_OR_BUDGET_UNSUPPORTED", anchorFor(0, text.length)); return []; }
  const statements = [], groups = [];
  let group = [];
  for (const token of all) {
    if (token.text === ";") { if (group.length) groups.push(group); group = []; }
    else group.push(token);
  }
  if (group.length) groups.push(group);
  if (embedded && groups.length > 1) { addGap(material, "sql", "SQL_MULTI_STATEMENT_LITERAL_UNSUPPORTED", anchorFor(0, text.length)); return []; }
  for (const items of groups) {
    const words = items.map(token => token.text.toUpperCase());
    const verb = words[0];
    let tableIndex = -1, predicate = null;
    if (verb === "SELECT") { tableIndex = words.indexOf("FROM") + 1; predicate = "readsTable"; }
    else if (verb === "UPDATE") { tableIndex = 1; predicate = "writesTable"; }
    else if (verb === "INSERT" && words[1] === "INTO") { tableIndex = 2; predicate = "writesTable"; }
    else if (verb === "DELETE" && words[1] === "FROM") { tableIndex = 2; predicate = "writesTable"; }
    else if (verb === "CREATE") {
      let index = 1;
      if (["TEMP", "TEMPORARY", "UNLOGGED"].includes(words[index])) index++;
      if (words[index] === "TABLE") {
        tableIndex = index + 1; predicate = "declaresSqlTable";
        if (words.slice(tableIndex, tableIndex + 3).join(" ") === "IF NOT EXISTS") tableIndex += 3;
      }
    }
    const unsupported = tableIndex < 1 || !identifier(items[tableIndex])
      || items[tableIndex + 1]?.text === "." || words.some(word => ["JOIN", "UNION", "WITH", "EXECUTE", "PROCEDURE"].includes(word))
      || items.some((token, index) => index > 0 && words[index] === "SELECT")
      || (verb === "SELECT" && (tableIndex < 3 || words.includes("INTO") || items[tableIndex + 1]?.text === ","))
      || (predicate === "declaresSqlTable" && items[tableIndex + 1]?.text !== "(");
    if (unsupported) { addGap(material, "sql", "SQL_STATEMENT_UNSUPPORTED", anchorFor(items[0].start, items.at(-1).end)); continue; }
    const tableName = label(items[tableIndex]);
    if (Buffer.byteLength(tableName, "utf8") > 256) { addGap(material, "sql", "SQL_IDENTIFIER_LIMIT", anchorFor(items[tableIndex].start, items[tableIndex].end)); continue; }
    if (isSensitiveKey(tableName)) { addGap(material, "sql", "SQL_IDENTIFIER_RESTRICTED", anchorFor(items[tableIndex].start, items[tableIndex].end)); continue; }
    const statementAnchor = anchorFor(items[0].start, items.at(-1).end);
    const statement = addObject(objectMaterial, "SQL_STATEMENT", verb, statementAnchor);
    const declaration = addFact({ subject: statement, predicate: "sqlOperation", value: { datatype: "string", value: verb }, material, anchor: statementAnchor });
    const table = addObject(objectMaterial, "SQL_TABLE", tableName, anchorFor(items[tableIndex].start, items[tableIndex].end));
    addFact({ subject: statement, predicate, target: table, basis: "DERIVED", premiseFactIds: [declaration], material, anchor: table.anchor });
    sqlReferences.push({ material, table, statement, declaration, declared: predicate === "declaresSqlTable" });
    statements.push({ object: statement, declaration });
    // Only column declarations in CREATE TABLE's direct list; values and WHERE
    // expressions are intentionally never indexed as column/value declarations.
    if (predicate === "declaresSqlTable" && items[tableIndex + 1]?.text === "(") {
      let depth = 0, first = true;
      for (const token of items.slice(tableIndex + 1)) {
        if (token.text === "(") { depth++; continue; }
        if (token.text === ")") { depth--; continue; }
        if (depth === 1 && token.text === ",") { first = true; continue; }
        if (depth !== 1 || !first) continue;
        first = false;
        if (!identifier(token) || ["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"].includes(token.text.toUpperCase()) || isSensitiveKey(label(token))) continue;
        const column = addObject(objectMaterial, "SQL_COLUMN", label(token), anchorFor(token.start, token.end));
        addFact({ subject: table, predicate: "declaresSqlColumn", target: column, basis: "DERIVED", premiseFactIds: [declaration], material, anchor: column.anchor });
      }
    }
  }
  return statements;
}

export function resolveSqlReferences({ sqlReferences, addFact, addGap }) {
  const declarations = new Map();
  for (const ref of sqlReferences.filter(ref => ref.declared)) {
    const key = JSON.stringify([ref.material.componentId, ref.table.name]);
    if (!declarations.has(key)) declarations.set(key, []);
    declarations.get(key).push(ref);
  }
  for (const ref of sqlReferences.filter(ref => !ref.declared)) {
    const candidates = declarations.get(JSON.stringify([ref.material.componentId, ref.table.name])) ?? [];
    if (candidates.length === 1) addFact({ subject: ref.table, predicate: "matchesSqlTable", target: candidates[0].table,
      basis: "DERIVED", premiseFactIds: [ref.declaration, candidates[0].declaration], material: ref.material, anchor: ref.table.anchor });
    else addGap(ref.material, "sql", candidates.length ? "SQL_TABLE_DECLARATION_AMBIGUOUS" : "SQL_TABLE_DECLARATION_UNAVAILABLE", ref.table.anchor);
  }
}

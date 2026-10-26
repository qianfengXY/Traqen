import { canonicalDigest } from "./identity.js";
import { technicalOnlyKinds, technicalPredicateDefinitions } from "./technical-vocabulary.js";

const recordKinds = [
  { kind: "MATERIAL", meaning: "冻结来源中的可寻址材料；即使未提取事实也保留。" },
  { kind: "OBJECT", meaning: "材料内由确定性语法或结构定位的对象。" },
  { kind: "EVIDENCE", meaning: "对象或事实回到冻结内容的精确锚点。" },
  { kind: "FACT", meaning: "有证据、规则及前提的属性或关系断言。" },
  { kind: "GAP", meaning: "明确范围内无法确定、不可用或不支持的限制。" },
];

const jsonKinds = ["JSON_OBJECT", "JSON_ARRAY", "JSON_VALUE", "OPENAPI_OPERATION", "OPENAPI_PARAMETER", "OPENAPI_RESPONSE", "TEST_RESULT"];
const reportKinds = ["JUNIT_SUITE", ...technicalOnlyKinds];
const documentKinds = ["DOCUMENT_PARAGRAPH", "DOCUMENT_LINK", "DOCUMENT_IMAGE"];
const expressKinds = ["EXPRESS_ROUTER", "EXPRESS_MOUNT"];
const javaKinds = ["JAVA_PACKAGE", "JAVA_PARAMETER", "JAVA_FIELD", "JAVA_ANNOTATION", "JAVA_CALL"];
const testKinds = ["TEST_CASE", "TEST_ASSERTION"];
export const predicateDefinitions = new Map([
  ...technicalPredicateDefinitions,
  ["contains", { meaning: "解析器证明的同材料直接结构父子关系；不证明业务归属或运行时包含。", form: "RELATION", domain: ["MATERIAL", "FUNCTION", "JAVASCRIPT_CLASS", "JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR", "DOCUMENT_SECTION", ...javaKinds, ...expressKinds, ...documentKinds, ...jsonKinds, ...testKinds, ...reportKinds], range: ["FUNCTION", "JAVASCRIPT_CLASS", "JAVASCRIPT_CALL", "JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR", "DOCUMENT_SECTION", "IMPORT", "ROUTE", "CONFIG_KEY", ...javaKinds, ...expressKinds, ...documentKinds, ...jsonKinds, ...testKinds, ...reportKinds] }],
  ["declares", { meaning: "语法结构中直接声明的符号绑定；不证明实例化、可达或执行。", form: "RELATION", domain: ["MATERIAL", "FUNCTION", "JAVASCRIPT_CLASS", "JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR"], range: ["FUNCTION", "JAVASCRIPT_CLASS", "JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR", "JAVA_FIELD"] }],
  ["imports", { meaning: "源码显式写出的导入声明；目标为声明对象，不证明目标已加载或链接成功。", form: "RELATION", domain: ["MATERIAL"], range: ["IMPORT"] }],
  ["name", { meaning: "对象声明的字面名称；不推断业务含义或运行身份。", form: "PROPERTY", domain: null, valueDatatypes: ["string"] }],
  ["bindingName", { meaning: "函数在源码词法声明中绑定的标识符；不证明运行时有效值或可达。", form: "PROPERTY", domain: ["FUNCTION"], valueDatatypes: ["string"] }],
  ["importedName", { meaning: "显式 import 指定的导出名；不证明模块已加载。", form: "PROPERTY", domain: ["IMPORT"], valueDatatypes: ["string"] }],
  ["exportedName", { meaning: "显式 export 写出的名称或 default；不证明运行时调用。", form: "PROPERTY", domain: ["FUNCTION"], valueDatatypes: ["string"] }],
  ["routerKind", { meaning: "Express 字面构造声明中的 application/router 类别；不证明加载、部署或运行。", form: "PROPERTY", domain: ["EXPRESS_ROUTER"], valueDatatypes: ["string"] }],
  ["mountsRouter", { meaning: "同模块顶层字面挂载声明与不可变绑定条件；不证明中间件顺序或实际请求命中。", form: "RELATION", domain: ["EXPRESS_ROUTER"], range: ["EXPRESS_ROUTER"] }],
  ["effectivePath", { meaning: "在所列应用及挂载前提下拼接的声明路径模式；不证明实际 URL、请求可达、优先级或已部署。", form: "PROPERTY", domain: ["ROUTE"], valueDatatypes: ["string"] }],
  ["refersTo", { meaning: "材料中显式引用的同版本目标；测试引用来自所列测试体及已证明的静态调用，不代表运行或覆盖；文档章节按固定标题片段规则解析，不承诺站点渲染锚点。", form: "RELATION", domain: ["MATERIAL", "DOCUMENT_LINK", "DOCUMENT_IMAGE", "TEST_CASE", ...jsonKinds], range: ["MATERIAL", "DOCUMENT_SECTION", "FUNCTION", "JAVA_METHOD", ...jsonKinds] }],
  ["type", { meaning: "JSON/配置或 Java AST 中写出的类型拼写；不推断 classpath、继承、程序运行类型或环境插值值。", form: "PROPERTY", domain: [...jsonKinds, "CONFIG_KEY", "JAVA_TYPE", "JAVA_METHOD", "JAVA_PARAMETER", "JAVA_FIELD"], valueDatatypes: ["string"] }],
  ["literalValue", { meaning: "原文中明确写出的标量声明值或文档段落原文；敏感内容受限，不推断运行值或业务语义。", form: "PROPERTY", domain: ["JSON_VALUE", "CONFIG_KEY", "DOCUMENT_PARAGRAPH"], valueDatatypes: ["string", "integer", "number", "boolean", "null"] }],
  ["declaresParameter", { meaning: "OpenAPI 或 Java AST 中显式写出的参数声明；不证明实现接受、验证或运行时使用该参数。", form: "RELATION", domain: ["OPENAPI_OPERATION", "JAVA_METHOD", "JAVA_CONSTRUCTOR", "JAVA_TYPE"], range: ["OPENAPI_PARAMETER", "JAVA_PARAMETER"] }],
  ["packageName", { meaning: "Java 源码 package 声明；不证明 classpath 或部署归属。", form: "PROPERTY", domain: ["MATERIAL"], valueDatatypes: ["string"] }],
  ["qualifiedName", { meaning: "Java 源码包与语法类型层级组成的声明名称；不证明 JVM 二进制身份或 classpath 绑定。", form: "PROPERTY", domain: ["JAVA_TYPE"], valueDatatypes: ["string"] }],
  ["signature", { meaning: "Java 方法名及原文参数类型拼写组成的声明签名；不进行类型擦除、重载选择或类型推导。", form: "PROPERTY", domain: ["JAVA_METHOD", "JAVA_CONSTRUCTOR"], valueDatatypes: ["string"] }],
  ["staticModifier", { meaning: "Java AST 明确写出或未写出 static 修饰符；不证明方法已调用。", form: "PROPERTY", domain: ["JAVA_METHOD", "JAVA_CONSTRUCTOR"], valueDatatypes: ["boolean"] }],
  ["visibility", { meaning: "Java 声明显式访问修饰符或未写修饰符的 package 类别；不证明模块、classpath 或运行时可访问性。", form: "PROPERTY", domain: ["JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR"], valueDatatypes: ["string"] }],
  ["hasTypeParameters", { meaning: "Java 声明是否写出类型参数；false 不代表运行时类型推断或擦除结果。", form: "PROPERTY", domain: ["JAVA_TYPE", "JAVA_METHOD", "JAVA_CONSTRUCTOR"], valueDatatypes: ["boolean"] }],
  ["lexicalShadow", { meaning: "受限 Java AST 审计发现同文件同名变量/类型/类型参数或未支持绑定语法，不能排除接收者首段遮蔽；不做 classpath、实例或运行值推断。", form: "PROPERTY", domain: ["JAVA_CALL"], valueDatatypes: ["boolean"] }],
  ["hasInheritance", { meaning: "Java 类型显式继承/实现或 interface 语法标记；false 不是运行时不存在父类的证明。", form: "PROPERTY", domain: ["JAVA_TYPE"], valueDatatypes: ["boolean"] }],
  ["parameterIndex", { meaning: "Java AST 参数在其直接声明者列表中的从零开始位置；不是物理行号。", form: "PROPERTY", domain: ["JAVA_PARAMETER"], valueDatatypes: ["integer"] }],
  ["annotationName", { meaning: "Java 原文注解名称拼写；不证明注解类型解析、元注解或框架执行。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["string"] }],
  ["annotationType", { meaning: "直接全限定拼写或唯一显式导入条件下的框架注解名称；不证明 classpath、元注解或框架运行。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["string"] }],
  ["mappingPath", { meaning: "直接映射注解中明确写出的字面路径条件；不证明请求实际命中。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["string"] }],
  ["mappingDefaultPath", { meaning: "直接映射注解未写出路径参数，固定规则使用空路径条件；不是已部署根路径。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["boolean"] }],
  ["mappingMethod", { meaning: "直接映射注解及枚举声明前提下的 HTTP 方法条件；ANY 表示没有显式方法限制，不证明服务接受请求。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["string"] }],
  ["mappingMethodReference", { meaning: "映射注解中原文 RequestMethod 枚举成员拼写；不证明类型已加载。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["string"] }],
  ["mappingDefaultMethod", { meaning: "RequestMapping 原文未写出 method 属性；固定规则保留未限制条件。", form: "PROPERTY", domain: ["JAVA_ANNOTATION"], valueDatatypes: ["boolean"] }],
  ["mappingClassAbsent", { meaning: "该直接控制器类型未声明类级映射注解；不推断继承或元注解映射。", form: "PROPERTY", domain: ["JAVA_TYPE"], valueDatatypes: ["boolean"] }],
  ["importKind", { meaning: "Java 原文 TYPE/STATIC 及 WILDCARD 导入形式；不证明类加载或方法绑定。", form: "PROPERTY", domain: ["IMPORT"], valueDatatypes: ["string"] }],
  ["argumentCount", { meaning: "Java 调用语法中直接参数表达式的数量；不进行可变参数或重载推导。", form: "PROPERTY", domain: ["JAVA_CALL"], valueDatatypes: ["integer"] }],
  ["receiverName", { meaning: "Java 调用语法写出的接收者拼写，空串表示未显式写出；不证明对象运行身份。", form: "PROPERTY", domain: ["JAVA_CALL"], valueDatatypes: ["string"] }],
  ["staticCalls", { meaning: "静态且词法可解析的直接调用；不证明实际执行。", form: "RELATION", domain: ["FUNCTION", "JAVA_METHOD"], range: ["FUNCTION", "JAVA_METHOD"] }],
  ["httpMethod", { meaning: "路由或 OpenAPI 合同中声明的 HTTP 方法；不证明服务已部署。", form: "PROPERTY", domain: ["ROUTE", "OPENAPI_OPERATION"], valueDatatypes: ["string"] }],
  ["path", { meaning: "路由、挂载、OpenAPI、导入或文档引用中声明的字面路径；不证明实际可达、已下载或已加载。", form: "PROPERTY", domain: ["ROUTE", "EXPRESS_MOUNT", "OPENAPI_OPERATION", "IMPORT", "DOCUMENT_LINK", "DOCUMENT_IMAGE"], valueDatatypes: ["string"] }],
  ["handlesRoute", { meaning: "静态可证明的处理器绑定；不包含动态中间件或反射。", form: "RELATION", domain: ["FUNCTION", "JAVA_METHOD"], range: ["ROUTE"] }],
  ["matchesEndpointContract", { meaning: "同组件范围内，所列 HTTP 方法与受限声明路径形状前提匹配；参数名称不参与形状比较，大小写和尾斜杠保留。唯一性仅针对当前受支持的已登记声明条件，不发现应用/主机身份，不推断服务器 URL 或基路径，不证明部署、请求可达、参数约束兼容、业务实现等价或测试覆盖。", form: "RELATION", domain: ["OPENAPI_OPERATION"], range: ["ROUTE"] }],
  ["testName", { meaning: "测试或报告中声明的测试名称；不证明测试已经执行。", form: "PROPERTY", domain: ["TEST_CASE", "TEST_RESULT"], valueDatatypes: ["string"] }],
  ["registrationName", { meaning: "直接测试注册调用或测试注解的原文名称；不证明执行或覆盖。", form: "PROPERTY", domain: ["TEST_CASE"], valueDatatypes: ["string"] }],
  ["testBody", { meaning: "测试声明直接指定的函数体或注解方法；不包含延迟的内层函数，不证明执行。", form: "RELATION", domain: ["TEST_CASE"], range: ["FUNCTION", "JAVA_METHOD"] }],
  ["testFramework", { meaning: "精确显式导入及语法前提下识别的测试/断言框架声明；不证明模块或类已加载，更不是执行成功。", form: "PROPERTY", domain: testKinds, valueDatatypes: ["string"] }],
  ["assertionName", { meaning: "断言调用位置的标识符或成员名称拼写；不证明断言成立。", form: "PROPERTY", domain: ["TEST_ASSERTION"], valueDatatypes: ["string"] }],
  ["assertionReceiver", { meaning: "断言调用的原文接收者名称；空串表示直接调用，不证明运行时对象身份。", form: "PROPERTY", domain: ["TEST_ASSERTION"], valueDatatypes: ["string"] }],
  ["hasAssertion", { meaning: "测试体内直接归属且导入绑定可辨认的断言调用声明；不证明执行、通过或业务覆盖。", form: "RELATION", domain: ["TEST_CASE"], range: ["TEST_ASSERTION"] }],
  ["reportsResult", { meaning: "报告文本声明的结果；不证明报告属于当前来源、环境或执行。", form: "PROPERTY", domain: ["TEST_RESULT"], valueDatatypes: ["string"] }],
  ["reportOutcomeMarker", { meaning: "有界 JUnit 报告直接结果子元素的类别；none 表示该测试节点未出现 failure/error/skipped，不证明测试执行。", form: "PROPERTY", domain: ["TEST_RESULT"], valueDatatypes: ["string"] }],
  ...[["reportTestId", "用例标识"], ["reportSourceBundleId", "来源 Bundle 标识"], ["reportCommand", "命令"], ["reportEnvironment", "环境"], ["reportProducer", "报告产生者"], ["reportTestedVersion", "被测版本"]].map(([key, meaning]) => [key, {
    meaning: `报告文本自行声明的${meaning}；不证明与代码身份绑定、授权、命令执行或可信来源，不按同名自动连线。`, form: "PROPERTY", domain: ["TEST_RESULT"], valueDatatypes: ["string"],
  }]),
  ["declaresResponse", { meaning: "OpenAPI 合同中声明的响应；不证明实现会返回该响应。", form: "PROPERTY", domain: ["OPENAPI_OPERATION"], valueDatatypes: ["string"] }],
]);

const prohibitions = [
  "文档、OpenAPI 与测试报告的声明不等于已实现或实际执行。",
  "静态调用、静态路由和显式引用不等于运行时可达或实际调用。",
  "没有事实或 Gap 不等于材料、系统或业务语义完备。",
  "图片与二进制的元数据不等于图中业务含义。",
];

function compare(left, right) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }

export function vocabularyFor({ profile, records }) {
  const supportedKinds = kinds => kinds?.filter(kind => profile.extractionLimits?.programLogic === "bounded-syntax-v1" || !technicalOnlyKinds.includes(kind));
  const predicates = [...new Set(records.filter((record) => record.kind === "FACT").map((record) => record.payload.predicate))]
    .sort(compare)
    .map((predicate) => {
      const definition = predicateDefinitions.get(predicate);
      return definition ? {
        predicate,
        form: definition.form,
        domain: supportedKinds(definition.domain) ?? null,
        ...(definition.range ? { range: supportedKinds(definition.range) } : {}),
        ...(definition.valueDatatypes ? { valueDatatypes: definition.valueDatatypes } : {}),
        meaning: definition.meaning,
      } : { predicate, meaning: "服务器规则产生的受限技术断言；不得外推未列出的语义。" };
    });
  const vocabulary = {
    schemaVersion: profile.schemaVersion,
    recordKinds,
    factForms: [
      { kind: "PROPERTY", meaning: "主体具有带显式 datatype 的值。" },
      { kind: "RELATION", meaning: "主体经谓词指向同版本目标对象。" },
    ],
    bases: [
      { basis: "DECLARED", meaning: "来自原材料的显式声明。" },
      { basis: "DERIVED", meaning: "由固定规则及列出的前提导出。" },
    ],
    predicates,
    prohibitions,
  };
  return { ...vocabulary, digest: canonicalDigest("VOCABULARY", vocabulary) };
}

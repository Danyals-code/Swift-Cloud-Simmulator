import type { Diagnostic, DiagnosticCode, FileId, SourceSpan } from '@studio/shared'
import { Lexer } from './lexer'
import {
  ASSIGNMENT_OPERATORS,
  DECLARATION_KEYWORDS,
  precedenceOf,
  RIGHT_ASSOCIATIVE,
  tokenDescription,
  type Token,
} from './tokens'
import type {
  Argument,
  AssociatedType,
  Attribute,
  Block,

  ClosureExpr,
  ClosureParam,
  Condition,
  Decl,
  EnumCase,
  CatchClause,
  Expr,
  GenericParam,
  IfStmt,
  Modifier,
  NamedType,
  Param,
  Pattern,
  PatternBinding,
  SourceFileNode,
  Stmt,
  StringExprSegment,
  SwitchCase,
  TypeRef,
} from './ast'

export interface ParseResult {
  readonly sourceFile: SourceFileNode
  readonly diagnostics: readonly Diagnostic[]
}

/** Declarations outside the subset, mapped to the name the diagnostic should use. */
const UNSUPPORTED_DECLARATIONS: Readonly<Record<string, string>> = {
  typealias: 'typealias',

  subscript: 'subscript',
  operator: 'operator declaration',
  associatedtype: 'associatedtype',
  deinit: 'deinit',
}

/** Statements outside the subset. */
const UNSUPPORTED_STATEMENTS: Readonly<Record<string, string>> = {
  defer: 'defer',
  fallthrough: 'fallthrough',
}

/**
 * Keywords that, at column 1, mean "a new top-level declaration started" rather than
 * "a nested declaration". Used only for missing-brace recovery.
 */
const TOP_LEVEL_RECOVERY_KEYWORDS = new Set([
  'struct', 'class', 'enum', 'protocol', 'extension', 'import',
])

const DECLARATION_MODIFIERS = new Set([
  'public', 'private', 'fileprivate', 'internal', 'open', 'static', 'final',
  'mutating', 'nonmutating', 'override', 'convenience', 'required', 'lazy',
  'weak', 'unowned', 'class',
])

/**
 * Recursive-descent parser for the supported Swift subset.
 *
 * Error recovery is a requirement here, not a nicety: the user is mid-keystroke most
 * of the time, so a missing brace must not invalidate the file. Two mechanisms do the
 * work - `ErrorNode`s stand in for unparseable fragments, and `synchronize()`
 * skips to the next declaration or statement boundary. Between them, a broken
 * region costs one diagnostic and the rest of the file still yields a usable tree.
 */
export class Parser {
  private index = 0
  private readonly diagnostics: Diagnostic[] = []
  /** Guards against a recovery loop that fails to consume anything. */
  private lastErrorOffset = -1

  private constructor(
    private readonly tokens: readonly Token[],
    private readonly file: FileId,
  ) {}

  static parse(text: string, file: FileId): ParseResult {
    const lexed = Lexer.tokenize(text, file)
    const parser = new Parser(lexed.tokens, file)
    const sourceFile = parser.parseSourceFile()
    return {
      sourceFile,
      diagnostics: [...lexed.diagnostics, ...parser.diagnostics],
    }
  }

  // ------------------------------------------------------------ token access

  private get current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!
  }

  private peek(offset = 1): Token {
    return this.tokens[this.index + offset] ?? this.tokens[this.tokens.length - 1]!
  }

  private get atEnd(): boolean {
    return this.current.kind === 'endOfFile'
  }

  private advance(): Token {
    const token = this.current
    if (!this.atEnd) this.index++
    return token
  }

  private check(text: string): boolean {
    return this.current.text === text && this.current.kind !== 'stringLiteral'
  }

  private checkKeyword(word: string): boolean {
    return this.current.kind === 'keyword' && this.current.text === word
  }

  private match(text: string): boolean {
    if (!this.check(text)) return false
    this.advance()
    return true
  }

  private expect(text: string, context: string): Token | null {
    if (this.check(text)) return this.advance()
    this.error(
      this.current.span,
      'expected_token',
      `Expected '${text}' ${context}, found ${tokenDescription(this.current)}.`,
    )
    return null
  }

  private expectIdentifier(context: string): { name: string; span: SourceSpan } {
    if (this.current.kind === 'identifier') {
      const token = this.advance()
      return { name: token.text, span: token.span }
    }
    this.error(
      this.current.span,
      'expected_token',
      `Expected ${context}, found ${tokenDescription(this.current)}.`,
    )
    return { name: '', span: this.current.span }
  }

  private error(span: SourceSpan, code: DiagnosticCode, message: string): void {
    // One diagnostic per offset. Cascading errors from a single mistake are noise
    // that buries the real one.
    if (span.start === this.lastErrorOffset) return
    this.lastErrorOffset = span.start
    this.diagnostics.push({ span, severity: 'error', code, message })
  }

  private unsupported(span: SourceSpan, feature: string, hint?: string): void {
    this.diagnostics.push({
      span,
      severity: 'warning',
      code: 'unsupported_language_feature',
      feature,
      message:
        `'${feature}' is not supported in the preview yet. ` +
        (hint ?? 'It is still exported to Xcode exactly as written.'),
    })
  }

  private spanFrom(start: Token): SourceSpan {
    const endToken = this.tokens[Math.max(0, this.index - 1)] ?? start
    return { file: this.file, start: start.span.start, end: endToken.span.end }
  }

  // ------------------------------------------------------------- source file

  private parseSourceFile(): SourceFileNode {
    const first = this.current
    const declarations: Decl[] = []

    while (!this.atEnd) {
      this.skipSemicolons()
      if (this.atEnd) break
      const before = this.index
      const decl = this.parseDeclaration()
      if (decl) declarations.push(decl)
      // Absolute guarantee of progress: without this a recovery path that consumes
      // nothing becomes an infinite loop, which in a Web Worker means a hung preview.
      if (this.index === before) this.advance()
    }

    return {
      kind: 'sourceFile',
      file: this.file,
      span: { file: this.file, start: first.span.start, end: this.current.span.end },
      declarations,
    }
  }

  // ------------------------------------------------------------ declarations

  private parseDeclaration(): Decl | null {
    const start = this.current
    const attributes = this.parseAttributes()
    const modifiers = this.parseModifiers()

    if (this.checkKeyword('import')) return this.parseImport()
    if (this.checkKeyword('struct')) return this.parseStruct(attributes, modifiers, false)
    if (this.checkKeyword('class')) return this.parseStruct(attributes, modifiers, true)
    if (this.checkKeyword('enum')) return this.parseEnum(attributes, modifiers)
    if (this.checkKeyword('protocol')) return this.parseProtocol(attributes, modifiers)
    if (this.checkKeyword('extension')) return this.parseExtension(attributes, modifiers)
    if (this.checkKeyword('func')) return this.parseFunc(attributes, modifiers)

    if (this.checkKeyword('var') || this.checkKeyword('let')) {
      return this.parseVar(attributes, modifiers)
    }
    if (this.checkKeyword('init')) return this.parseInit(attributes, modifiers)
    if (this.current.kind === 'macro') return this.parseMacro(attributes, modifiers)

    const unsupportedFeature = UNSUPPORTED_DECLARATIONS[this.current.text]
    if (this.current.kind === 'keyword' && unsupportedFeature) {
      return this.parseUnsupportedDecl(unsupportedFeature)
    }

    if (attributes.length > 0 || modifiers.length > 0) {
      this.error(
        this.current.span,
        'unexpected_token',
        `Expected a declaration after attributes, found ${tokenDescription(this.current)}.`,
      )
      this.synchronizeToDeclaration()
      return { kind: 'errorDecl', span: this.spanFrom(start), message: 'Expected a declaration.' }
    }

    this.error(
      this.current.span,
      'unexpected_token',
      `Expected a declaration, found ${tokenDescription(this.current)}.`,
    )
    this.synchronizeToDeclaration()
    return { kind: 'errorDecl', span: this.spanFrom(start), message: 'Expected a declaration.' }
  }

  private parseAttributes(): Attribute[] {
    const attributes: Attribute[] = []
    while (this.current.kind === 'attribute') {
      const token = this.advance()

      // `@Environment(\.colorScheme)` names the value it wants in its argument, so
      // the arguments are parsed rather than skipped. A malformed argument list falls
      // back to brace matching so one bad attribute cannot eat the declaration.
      let args: Argument[] = []
      if (this.check('(')) {
        const before = this.index
        const parsed = this.tryParseArgumentList()
        if (parsed) args = parsed
        else {
          this.index = before
          this.skipBalanced('(', ')')
        }
      }

      attributes.push({
        span: this.spanFrom(token),
        name: token.text.slice(1),
        args,
      })
    }
    return attributes
  }

  private parseModifiers(): Modifier[] {
    const modifiers: Modifier[] = []
    while (
      this.current.kind === 'keyword' &&
      DECLARATION_MODIFIERS.has(this.current.text) &&
      // `class` is a modifier only in `class func`; standalone it is a declaration.
      !(this.current.text === 'class' && this.peek().text !== 'func')
    ) {
      const token = this.advance()
      if (this.check('(')) this.skipBalanced('(', ')') // private(set)
      modifiers.push({ span: token.span, name: token.text })
    }
    return modifiers
  }

  private parseImport(): Decl {
    const start = this.advance() // 'import'
    const parts: string[] = []
    do {
      if (this.current.kind !== 'identifier') break
      parts.push(this.advance().text)
    } while (this.match('.'))
    return { kind: 'importDecl', span: this.spanFrom(start), module: parts.join('.') }
  }

  /**
   * A `struct` or a `class`.
   *
   * One function for both: the syntax is identical, and the only difference -
   * reference versus value semantics - is a flag the interpreter reads at
   * instantiation. Splitting them would duplicate the member loop and the recovery
   * logic for no gain.
   */
  private parseStruct(
    attributes: Attribute[],
    modifiers: Modifier[],
    isReference: boolean,
  ): Decl {
    const keyword = isReference ? 'class' : 'struct'
    const start = this.advance() // 'struct' | 'class'
    const { name, span: nameSpan } = this.expectIdentifier(`a ${keyword} name`)
    const generics = this.parseGenericParameterList()

    const inherits = this.parseInheritanceClause()
    this.skipWhereClause()
    const members = this.parseTypeBody(keyword)

    return {
      kind: 'structDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      name,
      nameSpan,
      generics,
      inherits,
      members,
      isReference,
    }
  }

  /**
   * An `enum` with raw or associated values.
   *
   * `case a, b` declares two cases on one line, which is how most enums in view code
   * are written, so the comma form is handled rather than reported.
   */
  private parseEnum(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance() // 'enum'
    const { name, span: nameSpan } = this.expectIdentifier('an enum name')
    const generics = this.parseGenericParameterList()

    const inherits = this.parseInheritanceClause()
    this.skipWhereClause()
    const cases: EnumCase[] = []
    const members: Decl[] = []

    if (this.expect('{', 'to begin the enum body')) {
      while (!this.atEnd && !this.check('}') && !this.atProbableTopLevelDeclaration()) {
        this.skipSemicolons()
        if (this.check('}') || this.atEnd) break
        const before = this.index

        if (this.checkKeyword('case')) {
          this.advance()
          do {
            cases.push(this.parseEnumCase())
          } while (this.match(','))
        } else {
          const member = this.parseDeclaration()
          if (member) members.push(member)
        }

        if (this.index === before) this.advance()
      }
      this.expect('}', 'to close the enum body')
    }

    return {
      kind: 'enumDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      name,
      nameSpan,
      generics,
      inherits,
      cases,
      members,
    }
  }

  private parseEnumCase(): EnumCase {
    const start = this.current
    // A case name may be a keyword - `case none`, `case some(T)`, `case any`. Swift
    // treats the position as contextual, and `Optional` itself is declared this way.
    const { name, span: nameSpan } =
      this.current.kind === 'keyword'
        ? (() => {
            const token = this.advance()
            return { name: token.text, span: token.span }
          })()
        : this.expectIdentifier('an enum case name')

    const associated: Param[] = []
    if (this.check('(') ) {
      this.advance()
      while (!this.atEnd && !this.check(')')) {
        const paramStart = this.current
        // `case success(value: Int)` - a labelled payload. The label is recorded so
        // the case can be constructed either way.
        let label: string | null = null
        if (this.current.kind === 'identifier' && this.peek().text === ':') {
          label = this.advance().text
          this.advance()
        }
        const type = this.parseType()
        associated.push({
          span: this.spanFrom(paramStart),
          externalName: label,
          internalName: label ?? `_${associated.length}`,
          type,
          defaultValue: null,
          isInout: false,
        })
        if (!this.match(',')) break
      }
      this.expect(')', 'to close the associated values')
    }

    const rawValue = this.match('=') ? this.parseExpression(false) : null
    return { span: this.spanFrom(start), name, nameSpan, associated, rawValue }
  }

  /**
   * A `protocol`.
   *
   * The body is an ordinary type body, so a requirement and a default implementation
   * parse through exactly the same path - the difference is a missing body, which the
   * existing `parseFunc` and `parseVar` already represent. `associatedtype` is the one
   * member that has no equivalent elsewhere, so it is lifted out here.
   */
  private parseProtocol(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance() // 'protocol'
    const { name, span: nameSpan } = this.expectIdentifier('a protocol name')

    // `protocol Container<Item>` is primary-associated-type syntax, which names an
    // associated type rather than declaring a generic parameter.
    const associatedTypes: AssociatedType[] = []
    if (this.check('<')) {
      this.advance()
      while (!this.atEnd && !this.check('>')) {
        if (this.current.kind === 'identifier') {
          const token = this.advance()
          associatedTypes.push({ span: token.span, name: token.text, nameSpan: token.span })
        } else this.advance()
        if (!this.match(',')) break
      }
      this.expect('>', 'to close the primary associated types')
    }

    const inherits = this.parseInheritanceClause()
    const members: Decl[] = []

    if (this.expect('{', 'to begin the protocol body')) {
      while (!this.atEnd && !this.check('}') && !this.atProbableTopLevelDeclaration()) {
        this.skipSemicolons()
        if (this.check('}') || this.atEnd) break
        const before = this.index

        if (this.checkKeyword('associatedtype') || this.check('associatedtype')) {
          this.advance()
          const associated = this.expectIdentifier('an associated type name')
          associatedTypes.push({
            span: associated.span,
            name: associated.name,
            nameSpan: associated.span,
          })
          // `associatedtype Item: Equatable = Int` - constraint and default are both
          // type-level, and nothing at runtime can act on either.
          if (this.match(':')) this.parseType()
          if (this.match('=')) this.parseType()
        } else {
          const member = this.parseDeclaration()
          if (member) members.push(member)
        }

        if (this.index === before) this.advance()
      }
      this.expect('}', 'to close the protocol body')
    }

    return {
      kind: 'protocolDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      name,
      nameSpan,
      inherits,
      members,
      associatedTypes,
    }
  }

  /**
   * An `extension`.
   *
   * The extended type is parsed as a type rather than an identifier so that
   * `extension Array where Element == Int` and `extension Optional<String>` reach the
   * same place as `extension Card` - the generic arguments and the `where` clause are
   * dropped, because the interpreter dispatches on the base name alone.
   */
  private parseExtension(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance() // 'extension'
    const extended = this.parseType()

    let name = ''
    let nameSpan = extended.span
    if (extended.kind === 'namedType') name = extended.name
    else if (extended.kind === 'arrayType') name = 'Array'
    else if (extended.kind === 'dictionaryType') name = 'Dictionary'
    else if (extended.kind === 'optionalType') name = 'Optional'
    else {
      this.error(extended.span, 'unexpected_token', 'Expected a type name to extend.')
      nameSpan = extended.span
    }

    const inherits = this.parseInheritanceClause()
    if (this.checkKeyword('where') || this.check('where')) {
      // A constrained extension applies to some instantiations and not others, which
      // needs a type checker to decide. Applying it unconditionally is the lenient
      // reading, and lenient is the house rule.
      this.advance()
      while (!this.atEnd && !this.check('{')) this.advance()
    }

    const members = this.parseTypeBody('extension')

    return {
      kind: 'extensionDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      name,
      nameSpan,
      inherits,
      members,
    }
  }

  /**
   * `<T>`, `<T: Comparable>`, `<Key: Hashable, Value>`.
   *
   * Generics are *erased*: the parameter names are recorded so they resolve as types
   * inside the declaration, and nothing else happens. A dynamically typed interpreter
   * carries the real value at runtime regardless of what the annotation said, so a
   * substitution pass would compute something nothing reads. The constraint is kept
   * on the node because the export writes the user's source back out unchanged and a
   * reader of the tree should see what was written.
   */
  private parseGenericParameterList(): GenericParam[] {
    const generics: GenericParam[] = []
    if (!this.check('<')) return generics
    this.advance()

    while (!this.atEnd && !this.check('>')) {
      const start = this.current
      if (this.current.kind !== 'identifier') {
        this.advance()
        continue
      }
      const token = this.advance()
      const constraint = this.match(':') ? this.parseType() : null
      generics.push({
        span: this.spanFrom(start),
        name: token.text,
        nameSpan: token.span,
        constraint,
      })
      if (!this.match(',')) break
    }

    this.expect('>', 'to close the generic parameter list')
    return generics
  }

  /**
   * `where Element: Equatable`, dropped.
   *
   * A `where` clause narrows which instantiations a declaration applies to, which is
   * a question only a type checker can answer. Applying the declaration
   * unconditionally is the lenient reading, and lenient is the house rule: the export
   * carries the clause to a real compiler unchanged.
   */
  private skipWhereClause(): void {
    if (!this.checkKeyword('where') && !this.check('where')) return
    this.advance()
    while (!this.atEnd && !this.check('{') && !this.current.newlineBefore) this.advance()
  }

  private parseInheritanceClause(): NamedType[] {

    const inherits: NamedType[] = []
    if (this.match(':')) {
      do {
        const type = this.parseType()
        if (type.kind === 'namedType') inherits.push(type)
      } while (this.match(','))
    }
    return inherits
  }

  private parseTypeBody(keyword: string): Decl[] {
    const members: Decl[] = []
    if (this.expect('{', `to begin the ${keyword} body`)) {
      while (!this.atEnd && !this.check('}') && !this.atProbableTopLevelDeclaration()) {
        this.skipSemicolons()
        if (this.check('}') || this.atEnd) break
        const before = this.index
        const member = this.parseDeclaration()
        if (member) members.push(member)
        if (this.index === before) this.advance()
      }
      this.expect('}', `to close the ${keyword} body`)
    }
    return members
  }

  private parseFunc(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance() // 'func'
    const { name, span: nameSpan } = this.expectIdentifier('a function name')
    const generics = this.parseGenericParameterList()

    const params = this.parseParameterList()

    const isAsync = this.checkKeyword('async')
    if (isAsync) this.advance()
    const canThrow = this.checkKeyword('throws') || this.checkKeyword('rethrows')
    if (canThrow) this.advance()

    let returnType: TypeRef | null = null
    if (this.match('->')) returnType = this.parseType()

    this.skipWhereClause()
    const body = this.check('{') ? this.parseBlock() : null

    return {
      kind: 'funcDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      name,
      nameSpan,
      generics,
      params,
      returnType,
      body,
      canThrow,
      isAsync,
    }
  }

  private parseInit(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance() // 'init'
    if (this.check('?') || this.check('!')) this.advance() // failable init
    const params = this.parseParameterList()
    if (this.checkKeyword('throws')) this.advance()
    const body = this.check('{') ? this.parseBlock() : null
    return { kind: 'initDecl', span: this.spanFrom(start), attributes, modifiers, params, body }
  }

  private parseParameterList(): Param[] {
    const params: Param[] = []
    if (!this.expect('(', 'to begin the parameter list')) return params

    while (!this.atEnd && !this.check(')')) {
      const start = this.current
      let externalName: string | null = null
      let internalName = ''

      if (this.current.kind === 'identifier' || this.current.kind === 'keyword') {
        const firstName = this.advance().text
        if (this.current.kind === 'identifier' || this.current.kind === 'keyword') {
          if (!this.check(':')) {
            externalName = firstName
            internalName = this.advance().text
          } else {
            internalName = firstName
          }
        } else {
          internalName = firstName
        }
      }

      let type: TypeRef | null = null
      let isInout = false
      if (this.match(':')) {
        isInout = this.checkKeyword('inout')
        if (isInout) this.advance()
        type = this.parseType()
      }

      let defaultValue: Expr | null = null
      if (this.match('=')) defaultValue = this.parseExpression(true)

      params.push({
        span: this.spanFrom(start),
        externalName,
        internalName,
        type,
        defaultValue,
        isInout,
      })

      if (!this.match(',')) break
    }

    this.expect(')', 'to close the parameter list')
    return params
  }

  private parseVar(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance() // 'var' | 'let'
    const isLet = start.text === 'let'
    const { name, span: nameSpan } = this.expectIdentifier('a variable name')

    let typeAnnotation: TypeRef | null = null
    if (this.match(':')) typeAnnotation = this.parseType()

    let initializer: Expr | null = null
    if (this.match('=')) initializer = this.parseExpression(true)

    // A computed property: `var body: some View { … }`. Distinguished from a
    // trailing closure by the absence of an initialiser - `var x = Foo { }` is an
    // initialiser with a trailing closure, `var x: T { }` is a getter.
    //
    // `{ get }` and `{ get set }` look like getters but are protocol requirements:
    // they say a conformer must have the property, without saying how. Parsing them
    // as bodies would produce a getter that evaluates the identifier `get`.
    let accessor: Block | null = null
    let requirement: 'get' | 'get set' | null = null
    if (!initializer && this.check('{')) {
      requirement = this.tryParseAccessorRequirement()
      if (!requirement) accessor = this.parseBlock()
    } else if (initializer && this.check('{') && !this.current.newlineBefore) {

      // `var x = 1 { didSet { … } }` - property observers are out of scope.
      this.unsupported(this.current.span, 'property observers (willSet/didSet)')
      this.skipBalanced('{', '}')
    }

    return {
      kind: 'varDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      isLet,
      name,
      nameSpan,
      typeAnnotation,
      initializer,
      accessor,
      requirement,
    }
  }

  /**
   * `{ get }` / `{ get set }`, consumed only when that is the entire brace body.
   *
   * Anything else - including `{ get { … } set { … } }`, which is a real computed
   * property with explicit accessors - is left for `parseBlock`, so the index is
   * restored before returning null.
   */
  private tryParseAccessorRequirement(): 'get' | 'get set' | null {
    const before = this.index
    this.advance() // '{'

    const words: string[] = []
    while (!this.atEnd && (this.check('get') || this.check('set'))) {
      words.push(this.advance().text)
      // An accessor with a body is an implementation, not a requirement.
      if (this.check('{')) {
        this.index = before
        return null
      }
    }

    if (words.length > 0 && this.check('}') && words[0] === 'get') {
      this.advance() // '}'
      return words.length === 2 && words[1] === 'set' ? 'get set' : 'get'
    }

    this.index = before
    return null
  }

  /**
   * `#Preview { … }`, `#Preview("Dark") { … }`, and any other macro written where a
   * declaration goes.
   *
   * The arguments and body are parsed rather than skipped, because `#Preview`'s body
   * is the one thing in the file that says what to show when nothing else does.
   * Macros the preview does not act on still parse cleanly and export unchanged -
   * which is the point: `#` used to be an unexpected character, and the three
   * blocking errors that followed meant a file with a preview block did not render.
   */
  private parseMacro(attributes: Attribute[], modifiers: Modifier[]): Decl {
    const start = this.advance()

    const args = this.check('(') ? (this.tryParseArgumentList() ?? []) : []
    if (this.check('(')) this.skipBalanced('(', ')')

    const body = this.check('{') ? this.parseBlock() : null

    return {
      kind: 'macroDecl',
      span: this.spanFrom(start),
      attributes,
      modifiers,
      name: start.text,
      nameSpan: start.span,
      args,
      body,
    }
  }

  private parseUnsupportedDecl(feature: string): Decl {

    const start = this.advance()
    const name = this.current.kind === 'identifier' ? this.advance().text : null

    this.unsupported(
      start.span,
      feature,
      feature === 'class'
        ? 'Use a struct, or wait for Phase 2 when reference types land.'
        : undefined,
    )

    // Skip to the end of the construct so the rest of the file still parses.
    while (!this.atEnd && !this.check('{') && !this.current.newlineBefore) this.advance()
    if (this.check('{')) this.skipBalanced('{', '}')

    return { kind: 'unsupportedDecl', span: this.spanFrom(start), feature, name }
  }

  /**
   * Skips to the next plausible declaration start.
   *
   * Stops at a declaration keyword, at an attribute, or at a closing brace - the
   * last of which matters because it lets an enclosing `parseStruct` finish its own
   * member loop rather than consuming the rest of the file.
   */
  private synchronizeToDeclaration(): void {
    while (!this.atEnd) {
      if (this.check('}')) return
      if (this.current.kind === 'attribute') return
      if (this.current.kind === 'keyword' && DECLARATION_KEYWORDS.has(this.current.text)) return
      this.advance()
    }
  }

  /**
   * Detects the most common broken state in a live editor: a missing closing brace.
   *
   * Without this, `struct Later` following an unterminated body parses as a *nested*
   * type - which is what swiftc does too, and is defensible. But it means sema never
   * registers `Later` as a module-level type, so every use of it reports
   * "unresolved identifier". One missing brace becomes a screenful of red, exactly
   * while the user is still typing. Phase 1 gate 4 says a false positive is worse
   * than a missed error, and this is the biggest source of them.
   *
   * The trigger is deliberately narrow: only a *type* declaration or `import`, and
   * only at column 1. Nobody indents a genuinely nested type to column zero, so this
   * cannot misfire on well-formed code. `func`, `var` and attributes are excluded -
   * those do appear at column 1 in badly formatted but valid source.
   */
  private atProbableTopLevelDeclaration(): boolean {
    const token = this.current
    if (token.column !== 1 || !token.newlineBefore || token.kind !== 'keyword') return false
    return TOP_LEVEL_RECOVERY_KEYWORDS.has(token.text)
  }

  private skipBalanced(open: string, close: string): void {
    if (!this.check(open)) return
    let depth = 0
    do {
      if (this.check(open)) depth++
      else if (this.check(close)) depth--
      this.advance()
    } while (!this.atEnd && depth > 0)
  }

  // -------------------------------------------------------------- statements

  /** Swift allows `;` between statements *and* declarations written on one line. */
  private skipSemicolons(): void {
    while (this.check(';')) this.advance()
  }

  private parseBlock(): Block {
    const start = this.current
    if (!this.expect('{', 'to begin a block')) {
      return { kind: 'block', span: this.spanFrom(start), statements: [] }
    }

    const statements: Stmt[] = []
    while (!this.atEnd && !this.check('}') && !this.atProbableTopLevelDeclaration()) {
      this.skipSemicolons()
      if (this.check('}') || this.atEnd) break
      const before = this.index
      statements.push(this.parseStatement())
      if (this.index === before) this.advance()
    }

    this.expect('}', 'to close a block')
    return { kind: 'block', span: this.spanFrom(start), statements }
  }

  private parseStatement(): Stmt {
    const start = this.current

    if (this.checkKeyword('if')) return this.parseIf()
    if (this.checkKeyword('guard')) return this.parseGuard()
    if (this.checkKeyword('switch')) return this.parseSwitch()
    if (this.checkKeyword('for')) return this.parseForIn()
    if (this.checkKeyword('while')) return this.parseWhile()
    if (this.checkKeyword('repeat')) return this.parseRepeat()
    if (this.checkKeyword('return')) return this.parseReturn()

    if (this.checkKeyword('break')) {
      const token = this.advance()
      return { kind: 'breakStmt', span: token.span }
    }
    if (this.checkKeyword('continue')) {
      const token = this.advance()
      return { kind: 'continueStmt', span: token.span }
    }

    if (this.checkKeyword('do')) return this.parseDoCatch()

    if (this.checkKeyword('throw')) {
      this.advance()
      const value = this.parseExpression(true)
      return { kind: 'throwStmt', span: this.spanFrom(start), value }
    }

    if (
      this.current.kind === 'keyword' &&
      (this.checkKeyword('var') || this.checkKeyword('let') || this.checkKeyword('func') ||
        this.checkKeyword('struct') || this.checkKeyword('class') || this.checkKeyword('enum'))
    ) {
      const declaration = this.parseDeclaration()
      return declaration
        ? { kind: 'declStmt', span: this.spanFrom(start), declaration }
        : { kind: 'errorStmt', span: this.spanFrom(start), message: 'Expected a declaration.' }
    }

    if (this.current.kind === 'attribute') {
      const declaration = this.parseDeclaration()
      return declaration
        ? { kind: 'declStmt', span: this.spanFrom(start), declaration }
        : { kind: 'errorStmt', span: this.spanFrom(start), message: 'Expected a declaration.' }
    }

    const unsupportedFeature = UNSUPPORTED_STATEMENTS[this.current.text]
    if (this.current.kind === 'keyword' && unsupportedFeature) {
      return this.parseUnsupportedStatement(unsupportedFeature)
    }

    const expression = this.parseExpression(true)
    this.match(';')
    return { kind: 'exprStmt', span: this.spanFrom(start), expression }
  }

  private parseIf(): IfStmt {
    const start = this.advance() // 'if'
    const conditions = this.parseConditionList()
    const then = this.parseBlock()

    let elseBranch: Block | IfStmt | null = null
    if (this.checkKeyword('else')) {
      this.advance()
      elseBranch = this.checkKeyword('if') ? this.parseIf() : this.parseBlock()
    }

    return { kind: 'ifStmt', span: this.spanFrom(start), conditions, then, else: elseBranch }
  }

  private parseGuard(): Stmt {
    const start = this.advance() // 'guard'
    const conditions = this.parseConditionList()

    if (this.checkKeyword('else')) {
      this.advance()
    } else {
      this.error(this.current.span, 'expected_token', "Expected 'else' after a 'guard' condition.")
    }

    return { kind: 'guardStmt', span: this.spanFrom(start), conditions, else: this.parseBlock() }
  }

  private parseWhile(): Stmt {
    const start = this.advance() // 'while'
    const conditions = this.parseConditionList()
    return { kind: 'whileStmt', span: this.spanFrom(start), conditions, body: this.parseBlock() }
  }

  private parseRepeat(): Stmt {
    const start = this.advance() // 'repeat'
    const body = this.parseBlock()

    if (this.checkKeyword('while')) {
      this.advance()
    } else {
      this.error(this.current.span, 'expected_token', "Expected 'while' after a 'repeat' body.")
    }

    return { kind: 'repeatStmt', span: this.spanFrom(start), body, condition: this.parseExpression(false) }
  }

  /**
   * A comma-separated condition list, as `if` / `guard` / `while` all take.
   *
   * Trailing closures are disallowed throughout, otherwise the body's `{` would be
   * parsed as a closure argument to the last condition.
   */
  private parseConditionList(): Condition[] {
    const conditions: Condition[] = []

    do {
      if (this.checkKeyword('let') || this.checkKeyword('var')) {
        const isLet = this.current.text === 'let'
        this.advance()
        const { name, span: nameSpan } = this.expectIdentifier('a binding name')

        // `if let user` with no `=` is Swift 5.7 shorthand for `if let user = user`.
        const value: Expr = this.match('=')
          ? this.parseExpression(false)
          : { kind: 'identifier', span: nameSpan, name }

        conditions.push({ kind: 'optionalBinding', name, nameSpan, isLet, value })
        continue
      }

      if (this.checkKeyword('case')) {
        this.advance()
        const pattern = this.parsePattern()
        if (!this.match('=')) {
          this.error(this.current.span, 'expected_token', "Expected '=' after a 'case' pattern.")
        }
        conditions.push({ kind: 'caseMatch', pattern, value: this.parseExpression(false) })
        continue
      }

      conditions.push({ kind: 'expr', expr: this.parseExpression(false) })
    } while (this.match(','))

    return conditions
  }

  // ------------------------------------------------------------------ switch

  private parseSwitch(): Stmt {
    const start = this.advance() // 'switch'
    const subject = this.parseExpression(false)
    const cases: SwitchCase[] = []

    if (!this.match('{')) {
      this.error(this.current.span, 'expected_token', "Expected '{' after a 'switch' subject.")
      return { kind: 'switchStmt', span: this.spanFrom(start), subject, cases }
    }

    while (!this.atEnd && !this.check('}')) {
      this.skipSemicolons()
      if (this.check('}')) break

      // Progress guard. Every other loop over declarations has one; this one did not,
      // so a pattern the parser could neither consume nor recover from spun here
      // forever. A hang is categorically worse than a mis-parse: a wrong tree still
      // renders something and still exports, while a hang takes the worker with it.
      const loopStart = this.index

      const caseStart = this.current
      const isDefault = this.checkKeyword('default')
      const patterns: Pattern[] = []

      if (isDefault) {
        this.advance()
      } else if (this.checkKeyword('case')) {
        this.advance()
        do {
          patterns.push(this.parsePattern())
        } while (this.match(','))
      } else {
        this.error(
          this.current.span,
          'unexpected_token',
          `Expected 'case' or 'default' in a switch, found ${tokenDescription(this.current)}.`,
        )
        this.advance()
        continue
      }

      const where = this.checkKeyword('where') ? (this.advance(), this.parseExpression(false)) : null
      if (!this.match(':')) {
        this.error(this.current.span, 'expected_token', "Expected ':' after a switch case.")
      }

      // A case body runs to the next `case`, `default` or the closing brace. Swift
      // has no implicit fallthrough, so there is no terminator to consume.
      const statements: Stmt[] = []
      const bodyStart = this.current
      while (
        !this.atEnd &&
        !this.check('}') &&
        !this.checkKeyword('case') &&
        !this.checkKeyword('default')
      ) {
        this.skipSemicolons()
        if (this.atEnd || this.check('}') || this.checkKeyword('case') || this.checkKeyword('default')) break
        // `parseBlock` guards its statement loop the same way. A statement the parser
        // can neither consume nor recover from returns an error node without moving,
        // and a loop that does not check for that never ends.
        const before = this.index
        statements.push(this.parseStatement())
        if (this.index === before) this.advance()
      }

      cases.push({
        span: this.spanFrom(caseStart),
        patterns,
        where,
        isDefault,
        body: { kind: 'block', span: this.spanFrom(bodyStart), statements },
      })

      if (this.index === loopStart) this.advance()
    }

    this.expect('}', "Expected '}' to close the switch.")
    return { kind: 'switchStmt', span: this.spanFrom(start), subject, cases }
  }

  /**
   * One `case` pattern.
   *
   * The supported set is small and deliberately so: an unsupported pattern is
   * reported by name rather than half-matched, because a pattern that silently fails
   * sends execution down the wrong branch.
   */
  private parsePattern(): Pattern {
    const start = this.current

    if (this.check('_')) {
      this.advance()
      return { kind: 'wildcard', span: this.spanFrom(start) }
    }

    if (this.current.kind === 'identifier' && this.current.text === '_') {
      this.advance()
      return { kind: 'wildcard', span: this.spanFrom(start) }
    }

    // `case let x` / `case var x` - binds the whole subject.
    if (this.checkKeyword('let') || this.checkKeyword('var')) {
      const isLet = this.current.text === 'let'
      this.advance()

      // `case let .success(value)` - the binding applies inside the payload.
      if (this.check('.')) return this.parseEnumCasePattern(start, null, true)

      const { name } = this.expectIdentifier('a binding name')
      return { kind: 'binding', name, isLet, span: this.spanFrom(start) }
    }

    // `.home` or `Tab.home`, with or without a payload.
    if (this.check('.')) return this.parseEnumCasePattern(start, null, false)

    if (this.current.kind === 'identifier' && this.peek().text === '.') {
      const typeName = this.advance().text
      return this.parseEnumCasePattern(start, typeName, false)
    }

    const value = this.parseExpression(false)
    const isRange =
      value.kind === 'binary' && (value.operator === '...' || value.operator === '..<')
    return isRange
      ? { kind: 'range', value, span: this.spanFrom(start) }
      : { kind: 'value', value, span: this.spanFrom(start) }
  }

  private parseEnumCasePattern(
    start: Token,
    typeName: string | null,
    outerBinding: boolean,
  ): Pattern {
    this.expect('.', "Expected '.' before an enum case name.")
    // `parseMemberName`, not `expectIdentifier`: after a dot a case name may be a
    // keyword, and `.some` - the one every `Optional` match is written with - is
    // exactly that. `expectIdentifier` reports and does *not* advance, so the keyword
    // was left in place and the enclosing switch loop spun on it forever.
    const { name: caseName } = this.parseMemberName()

    const bindings: PatternBinding[] = []
    if (this.check('(')) {
      this.advance()
      while (!this.atEnd && !this.check(')')) {
        // `let` may appear per-binding (`case .x(let a)`) or once outside it.
        if (this.checkKeyword('let') || this.checkKeyword('var')) this.advance()

        const token = this.current
        if (token.kind === 'identifier' || token.kind === 'keyword') {
          this.advance()
          bindings.push({
            span: token.span,
            name: token.text,
            isWildcard: token.text === '_',
          })
        } else {
          this.advance()
        }
        if (!this.match(',')) break
      }
      this.expect(')', "Expected ')' to close an enum case pattern.")
    }

    void outerBinding
    return { kind: 'enumCase', typeName, caseName, bindings, span: this.spanFrom(start) }
  }

  private parseForIn(): Stmt {
    const start = this.advance() // 'for'

    if (this.checkKeyword('case')) {
      this.unsupported(this.current.span, 'for-case pattern matching')
    }

    const variable = this.current.kind === 'identifier' ? this.advance() : null
    if (!variable) {
      this.error(this.current.span, 'expected_token', 'Expected a loop variable name.')
    }

    if (!this.checkKeyword('in')) {
      this.error(
        this.current.span,
        'expected_token',
        `Expected 'in' after the loop variable, found ${tokenDescription(this.current)}.`,
      )
    } else {
      this.advance()
    }

    const sequence = this.parseExpression(false)
    const where = this.checkKeyword('where') ? (this.advance(), this.parseExpression(false)) : null
    const body = this.parseBlock()

    return {
      kind: 'forInStmt',
      span: this.spanFrom(start),
      variable: variable?.text ?? '',
      variableSpan: variable?.span ?? start.span,
      sequence,
      body,
      where,
    }
  }

  private parseReturn(): Stmt {
    const start = this.advance() // 'return'
    // A bare `return` is followed by `}` or a newline.
    const hasValue = !this.check('}') && !this.atEnd && !this.current.newlineBefore
    const value = hasValue ? this.parseExpression(true) : null
    return { kind: 'returnStmt', span: this.spanFrom(start), value }
  }

  /**
   * `do { … } catch … { … }`.
   *
   * `repeat { } while` is the loop; `do` here is only ever a scope with handlers, so
   * there is no trailing clause to disambiguate.
   */
  private parseDoCatch(): Stmt {
    const start = this.advance() // 'do'
    const body = this.parseBlock()
    const catches: CatchClause[] = []

    while (this.checkKeyword('catch')) {
      const clauseStart = this.advance()

      // `catch let problem { }` names the error; `catch MyError.bad { }` matches a
      // pattern and binds the implicit `error`; a bare `catch { }` does both by
      // default. Swift binds `error` in every clause that does not name its own.
      let pattern: Pattern | null = null
      let binding = 'error'

      if (this.checkKeyword('let') || this.checkKeyword('var')) {
        this.advance()
        const named = this.expectIdentifier('a name for the caught error')
        binding = named.name
        // `catch let problem as MyError` - the cast narrows, which needs types we do
        // not have. Binding without narrowing is the lenient reading.
        if (this.checkKeyword('as')) {
          this.advance()
          this.parseType()
        }
      } else if (!this.check('{')) {
        pattern = this.parsePattern()
      }

      // The body is parsed into a variable first: object properties evaluate in the
      // order written, so taking the span inline would end it before the body began -
      // and a clause whose span stops at its own `{` contains nothing the editor asks
      // about.
      const clauseBody = this.parseBlock()
      catches.push({ span: this.spanFrom(clauseStart), pattern, binding, body: clauseBody })
    }

    return { kind: 'doCatchStmt', span: this.spanFrom(start), body, catches }
  }

  private parseUnsupportedStatement(feature: string): Stmt {
    const start = this.current
    this.unsupported(start.span, feature)

    // Consume the head of the statement, then its block if it has one.
    this.advance()
    while (!this.atEnd && !this.check('{') && !this.check('}') && !this.current.newlineBefore) {
      this.advance()
    }
    if (this.check('{')) this.skipBalanced('{', '}')

    // `repeat { } while cond` and `do { } catch { }` have trailing clauses.
    while (
      !this.atEnd &&
      (this.checkKeyword('while') || this.checkKeyword('catch')) &&
      !this.current.newlineBefore
    ) {
      this.advance()
      while (!this.atEnd && !this.check('{') && !this.current.newlineBefore) this.advance()
      if (this.check('{')) this.skipBalanced('{', '}')
    }

    return { kind: 'unsupportedStmt', span: this.spanFrom(start), feature }
  }

  // ------------------------------------------------------------- expressions

  private parseExpression(allowTrailingClosure: boolean): Expr {
    return this.parseAssignment(allowTrailingClosure)
  }

  private parseAssignment(allowTrailing: boolean): Expr {
    const start = this.current
    const target = this.parseTernary(allowTrailing)

    if (this.current.kind === 'operator' && ASSIGNMENT_OPERATORS.has(this.current.text)) {
      const operator = this.advance().text
      const value = this.parseAssignment(allowTrailing) // right-associative
      return { kind: 'assign', span: this.spanFrom(start), operator, target, value }
    }

    return target
  }

  private parseTernary(allowTrailing: boolean): Expr {
    const start = this.current
    const condition = this.parseBinary(3, allowTrailing)

    if (this.current.kind === 'operator' && this.current.text === '?') {
      this.advance()
      const then = this.parseExpression(allowTrailing)
      this.expect(':', 'in a ternary expression')
      const otherwise = this.parseTernary(allowTrailing) // right-associative
      return { kind: 'ternary', span: this.spanFrom(start), condition, then, else: otherwise }
    }

    return condition
  }

  private parseBinary(minPrecedence: number, allowTrailing: boolean): Expr {
    const start = this.current
    let left = this.parseUnary(allowTrailing)

    for (;;) {
      const token = this.current

      // `is` / `as` sit at casting precedence.
      if (token.kind === 'keyword' && (token.text === 'is' || token.text === 'as')) {
        if (7 < minPrecedence) break
        this.advance()
        if (this.check('?') || this.check('!')) this.advance()
        const type = this.parseType()
        left = {
          kind: 'binary',
          span: this.spanFrom(start),
          operator: token.text,
          left,
          right: { kind: 'identifier', span: type.span, name: typeName(type) },
        }
        continue
      }

      if (token.kind !== 'operator') break
      const precedence = precedenceOf(token.text)
      if (precedence === undefined || precedence < minPrecedence) break
      // Assignment is handled by parseAssignment, above ternary.
      if (ASSIGNMENT_OPERATORS.has(token.text)) break

      this.advance()
      const nextMinimum = RIGHT_ASSOCIATIVE.has(token.text) ? precedence : precedence + 1
      const right = this.parseBinary(nextMinimum, allowTrailing)
      left = { kind: 'binary', span: this.spanFrom(start), operator: token.text, left, right }
    }

    return left
  }

  private parseUnary(allowTrailing: boolean): Expr {
    const start = this.current

    if (start.kind === 'keyword' && start.text === 'try') {
      this.advance()
      const mode = this.match('?') ? 'optional' : this.match('!') ? 'force' : 'propagate'
      return {
        kind: 'try',
        span: this.spanFrom(start),
        mode,
        operand: this.parseUnary(allowTrailing),
      }
    }

    // `await` is transparent. The preview evaluates an `async` function the same way
    // it evaluates any other, so the keyword marks a suspension point that never
    // happens - and a node that is always see-through would add a case to every
    // consumer for no behaviour. The limitation is recorded in the coverage matrix
    // beside `.task`, which has worked this way since Phase 7.
    if (start.kind === 'keyword' && start.text === 'await') {
      this.advance()
      return this.parseUnary(allowTrailing)
    }

    // `&value` supplying an `inout` argument. Only meaningful in a call, and the
    // prefix form is what tells it from the bitwise-and operator.
    if (start.kind === 'operator' && start.text === '&' && !start.spaceAfter) {
      this.advance()
      return { kind: 'inout', span: this.spanFrom(start), operand: this.parseUnary(allowTrailing) }
    }

    if (
      start.kind === 'operator' &&
      (start.text === '-' || start.text === '!' || start.text === '+') &&
      // Prefix operators have no space between themselves and their operand.
      !start.spaceAfter
    ) {
      this.advance()
      const operand = this.parseUnary(allowTrailing)
      return { kind: 'unary', span: this.spanFrom(start), operator: start.text, operand }
    }

    return this.parsePostfix(allowTrailing)
  }

  private parsePostfix(allowTrailing: boolean): Expr {
    const start = this.current
    let expr = this.parsePrimary(allowTrailing)

    for (;;) {
      // Member access continues across newlines - this is what makes SwiftUI's
      // modifier chains work:
      //     Text("x")
      //         .font(.largeTitle)
      if (this.check('.')) {
        this.advance()
        const member = this.parseMemberName()
        expr = {
          kind: 'memberAccess',
          span: this.spanFrom(start),
          base: expr,
          member: member.name,
          memberSpan: member.span,
        }
        continue
      }

      /**
       * Optional chaining: `?` immediately followed by `.`, with no space between.
       *
       * The whitespace is what tells `a?.b` from `a ? .b : c`, and Swift reads it the
       * same way. Without the check, the ternary's then-branch is swallowed as a
       * chain and the `:` that follows has nowhere to go - which is exactly what
       * `step == .one ? .two : .one` did.
       */
      if (
        this.current.kind === 'operator' &&
        this.current.text === '?' &&
        !this.current.spaceBefore &&
        !this.current.spaceAfter &&
        this.peek().text === '.'
      ) {
        this.advance()
        expr = { kind: 'optionalChain', span: this.spanFrom(start), operand: expr }
        continue
      }

      // Postfix `!` - force unwrap. No space before, or it is an infix/prefix operator.
      if (this.current.kind === 'operator' && this.current.text === '!' && !this.current.spaceBefore) {
        this.advance()
        expr = { kind: 'forceUnwrap', span: this.spanFrom(start), operand: expr }
        continue
      }

      // A call. `(` on a new line starts a new statement, not an argument list.
      if (this.check('(') && !this.current.newlineBefore) {
        const args = this.parseArgumentList('(', ')')
        expr = { kind: 'call', span: this.spanFrom(start), callee: expr, args, trailingClosure: null }
        continue
      }

      if (this.check('[') && !this.current.newlineBefore) {
        const args = this.parseArgumentList('[', ']')
        expr = { kind: 'subscript', span: this.spanFrom(start), base: expr, args }
        continue
      }

      // Trailing closure. Suppressed in condition position, where `{` opens a body.
      if (allowTrailing && this.check('{')) {
        const closure = this.parseClosure()
        expr =
          expr.kind === 'call' && expr.trailingClosure === null
            ? { ...expr, span: this.spanFrom(start), trailingClosure: closure }
            : {
                kind: 'call',
                span: this.spanFrom(start),
                callee: expr,
                args: [],
                trailingClosure: closure,
              }
        continue
      }

      return expr
    }
  }

  /** Member names may be keywords (`.self`, `.default`, `.init`). */
  /**
   * `Stack<Int>()` - explicit generic arguments in *expression* position.
   *
   * `<` is otherwise the less-than operator, so this is the one genuine ambiguity
   * generics introduce: `a < b` and `Stack<Int>` begin identically. Swift resolves it
   * by looking ahead for a balanced `>` immediately followed by `(`, `.` or `{`, and
   * so does this - with the index restored the moment the lookahead fails, so a
   * comparison is never mistaken for a type.
   *
   * The arguments are dropped rather than recorded. Generics are erased, and the
   * expression means the same thing without them.
   */
  private skipExplicitGenericArguments(): void {
    if (!this.check('<')) return

    const before = this.index
    let depth = 0
    while (!this.atEnd) {
      if (this.check('<')) depth++
      else if (this.check('>>')) {
        // `Box<Box<Int>>` closes two levels with one token: the lexer reads `>>` as
        // the shift operator, since it cannot know it is inside a type.
        depth -= 2
        if (depth <= 0) {
          this.advance()
          if (this.check('(') || this.check('.') || this.check('{')) return
          this.index = before
          return
        }
      } else if (this.check('>')) {
        depth--
        if (depth === 0) {
          this.advance()
          // Only a call, a member access or a trailing closure can follow a type here.
          // Anything else means this was a comparison after all.
          if (this.check('(') || this.check('.') || this.check('{')) return
          this.index = before
          return
        }
      } else if (
        // A type argument list holds types and separators, nothing else. Meeting a
        // token that cannot appear in one settles the ambiguity immediately, and
        // cheaply - `a < b && c > d` never reaches the closing brace.
        !(
          this.current.kind === 'identifier' ||
          this.check(',') ||
          this.check('.') ||
          this.check('?') ||
          this.check('[') ||
          this.check(']') ||
          this.check(':') ||
          this.check('->') ||
          this.check('(') ||
          this.check(')')
        )
      ) {
        this.index = before
        return
      }
      this.advance()
    }

    this.index = before
  }

  private parseMemberName(): { name: string; span: SourceSpan } {
    if (this.current.kind === 'identifier' || this.current.kind === 'keyword') {
      const token = this.advance()
      return { name: token.text, span: token.span }
    }
    // `.0` tuple access.
    if (this.current.kind === 'integerLiteral') {
      const token = this.advance()
      return { name: token.text, span: token.span }
    }
    this.error(
      this.current.span,
      'expected_token',
      `Expected a member name after '.', found ${tokenDescription(this.current)}.`,
    )
    return { name: '', span: this.current.span }
  }

  /**
   * Parses an argument list, or gives up without reporting anything.
   *
   * For attributes, where an unparseable argument must not produce a diagnostic - the
   * attribute is still perfectly good Swift, it is only this parser that cannot read
   * its argument, and brace matching skips it silently instead.
   */
  private tryParseArgumentList(): Argument[] | null {
    const diagnosticsBefore = this.diagnostics.length
    const args = this.parseArgumentList('(', ')')

    if (this.diagnostics.length > diagnosticsBefore) {
      this.diagnostics.length = diagnosticsBefore
      return null
    }
    return args
  }

  private parseArgumentList(open: string, close: string): Argument[] {
    const args: Argument[] = []
    this.expect(open, 'to begin an argument list')

    while (!this.atEnd && !this.check(close)) {
      const start = this.current
      let label: string | null = null
      let labelSpan: SourceSpan | null = null

      // `label: value` - but not `a ? b : c` and not a type annotation.
      if (
        (this.current.kind === 'identifier' || this.current.kind === 'keyword') &&
        this.peek().text === ':' &&
        this.peek().kind === 'punctuation'
      ) {
        const labelToken = this.advance()
        label = labelToken.text
        labelSpan = labelToken.span
        this.advance() // ':'
      }

      const value = this.parseExpression(true)
      args.push({ label, labelSpan, value, span: this.spanFrom(start) })

      if (!this.match(',')) break
    }

    this.expect(close, 'to close an argument list')
    return args
  }

  private parsePrimary(allowTrailing: boolean): Expr {
    const token = this.current

    switch (token.kind) {
      case 'integerLiteral':
        this.advance()
        return { kind: 'integerLiteral', span: token.span, value: token.numericValue ?? 0 }
      case 'floatLiteral':
        this.advance()
        return { kind: 'floatLiteral', span: token.span, value: token.numericValue ?? 0 }
      case 'stringLiteral':
        this.advance()
        return {
          kind: 'stringLiteral',
          span: token.span,
          segments: this.parseStringSegments(token),
        }
      case 'identifier':
        this.advance()
        this.skipExplicitGenericArguments()
        return { kind: 'identifier', span: token.span, name: token.text }
      default:
        break
    }

    if (token.kind === 'keyword') {
      switch (token.text) {
        case 'true':
        case 'false':
          this.advance()
          return { kind: 'booleanLiteral', span: token.span, value: token.text === 'true' }
        case 'nil':
          this.advance()
          return { kind: 'nilLiteral', span: token.span }
        case 'self':
          this.advance()
          return { kind: 'selfExpr', span: token.span }
        case 'super':
          this.advance()
          return { kind: 'superExpr', span: token.span }
        default:
          break
      }
      // A type name used as a value: `Color.red` lexes `Color` as an identifier, but
      // `Self` and `Any` are keywords that can appear in expression position.
      if (token.text === 'Self' || token.text === 'any' || token.text === 'some') {
        this.advance()
        return { kind: 'identifier', span: token.span, name: token.text }
      }
    }

    // Implicit member syntax: `.largeTitle`, `.infinity`, `.primary`.
    if (this.check('.')) {
      this.advance()
      const member = this.parseMemberName()
      return {
        kind: 'memberAccess',
        span: this.spanFrom(token),
        base: null,
        member: member.name,
        memberSpan: member.span,
      }
    }

    if (this.check('(')) return this.parseParenOrTuple(allowTrailing)
    if (this.check('[')) return this.parseCollectionLiteral()
    if (this.check('{')) return this.parseClosure()

    // Key paths: `\.self`, `\.id`, `\.author.name`, `\Item.title`.
    if (this.check('\\')) {
      this.advance()

      const components: string[] = []
      // An optional root type, as in `\Item.title`. It carries no information the
      // slice uses - the key path is applied to a value whose type is already known.
      if (this.current.kind === 'identifier' && !this.check('.')) this.advance()

      while (this.check('.')) {
        this.advance()
        components.push(this.parseMemberName().name)
      }

      if (components.length === 0) {
        this.error(token.span, 'unexpected_token', 'Expected a key path component after \\.')
      }
      return { kind: 'keyPath', span: this.spanFrom(token), components }
    }

    this.error(
      token.span,
      'unexpected_token',
      `Expected an expression, found ${tokenDescription(token)}.`,
    )
    return { kind: 'errorExpr', span: token.span, message: 'Expected an expression.' }
  }

  private parseStringSegments(token: Token): StringExprSegment[] {
    const segments: StringExprSegment[] = []

    for (const segment of token.segments ?? []) {
      if (segment.kind === 'text') {
        segments.push({ kind: 'text', value: segment.value, span: segment.span })
        continue
      }

      // Re-enter the parser on the interpolation's raw source. `baseOffset` keeps the
      // spans pointing at real file positions, so an error inside `\(…)` underlines
      // the right characters rather than something near the start of the file.
      const lexed = Lexer.tokenize(segment.value, this.file, segment.span.start)
      const sub = new Parser(lexed.tokens, this.file)
      const expression = sub.parseExpression(true)
      this.diagnostics.push(...lexed.diagnostics, ...sub.diagnostics)
      segments.push({ kind: 'interpolation', expression, span: segment.span })
    }

    return segments
  }

  private parseParenOrTuple(allowTrailing: boolean): Expr {
    const start = this.advance() // '('

    if (this.check(')')) {
      this.advance()
      return { kind: 'tuple', span: this.spanFrom(start), elements: [] }
    }

    const elements: Expr[] = []
    do {
      // Tuple element labels: `(x: 1, y: 2)`.
      if (
        (this.current.kind === 'identifier' || this.current.kind === 'keyword') &&
        this.peek().text === ':' &&
        this.peek().kind === 'punctuation'
      ) {
        this.advance()
        this.advance()
      }
      elements.push(this.parseExpression(allowTrailing))
    } while (this.match(','))

    this.expect(')', 'to close a parenthesised expression')

    return elements.length === 1
      ? elements[0]!
      : { kind: 'tuple', span: this.spanFrom(start), elements }
  }

  private parseCollectionLiteral(): Expr {
    const start = this.advance() // '['

    if (this.check(']')) {
      this.advance()
      return { kind: 'arrayLiteral', span: this.spanFrom(start), elements: [] }
    }
    // `[:]` is the empty dictionary.
    if (this.check(':') && this.peek().text === ']') {
      this.advance()
      this.advance()
      return { kind: 'dictionaryLiteral', span: this.spanFrom(start), entries: [] }
    }

    const first = this.parseExpression(true)

    if (this.check(':')) {
      this.advance()
      const entries = [{ key: first, value: this.parseExpression(true) }]
      while (this.match(',')) {
        if (this.check(']')) break // trailing comma
        const key = this.parseExpression(true)
        this.expect(':', 'between a dictionary key and its value')
        entries.push({ key, value: this.parseExpression(true) })
      }
      this.expect(']', 'to close a dictionary literal')
      return { kind: 'dictionaryLiteral', span: this.spanFrom(start), entries }
    }

    const elements = [first]
    while (this.match(',')) {
      if (this.check(']')) break // trailing comma
      elements.push(this.parseExpression(true))
    }
    this.expect(']', 'to close an array literal')
    return { kind: 'arrayLiteral', span: this.spanFrom(start), elements }
  }

  private parseClosure(): ClosureExpr {
    const start = this.current
    this.expect('{', 'to begin a closure')

    const params: ClosureParam[] = []
    let hasExplicitParams = false

    if (this.closureHasParameterList()) {
      hasExplicitParams = true
      if (this.check('[')) this.skipBalanced('[', ']') // capture list
      const parenthesised = this.match('(')

      while (!this.atEnd && !this.checkKeyword('in') && !this.check(')')) {
        if (this.current.kind === 'identifier' || this.current.kind === 'keyword') {
          const nameToken = this.advance()
          let type: TypeRef | null = null
          if (this.match(':')) type = this.parseType()
          params.push({ span: this.spanFrom(nameToken), name: nameToken.text, type })
        } else {
          this.advance()
        }
        if (!this.match(',')) break
      }

      if (parenthesised) this.expect(')', 'to close the closure parameter list')
      if (this.match('->')) this.parseType()
      if (this.checkKeyword('in')) this.advance()
    }

    const statements: Stmt[] = []
    while (!this.atEnd && !this.check('}') && !this.atProbableTopLevelDeclaration()) {
      this.skipSemicolons()
      if (this.check('}') || this.atEnd) break
      const before = this.index
      statements.push(this.parseStatement())
      if (this.index === before) this.advance()
    }
    this.expect('}', 'to close a closure')

    const span = this.spanFrom(start)
    return {
      kind: 'closure',
      span,
      params,
      hasExplicitParams,
      body: { kind: 'block', span, statements },
    }
  }

  /**
   * Decides whether a closure opens with a parameter list.
   *
   * The naive test - "is there an `in` before the closing brace" - is wrong, because
   * `{ for i in items { … } }` contains one. So the scan additionally requires that
   * everything before the `in` could actually *be* a parameter list: names, commas,
   * type annotations, an optional capture list and arrow. A `for` keyword, a literal,
   * or an operator disqualifies it immediately.
   */
  private closureHasParameterList(): boolean {
    let i = this.index
    let depth = 0

    while (i < this.tokens.length) {
      const token = this.tokens[i]!
      if (token.kind === 'endOfFile') return false

      if (token.text === '(' || token.text === '[' || token.text === '<') depth++
      else if (token.text === ')' || token.text === ']' || token.text === '>') depth--
      else if (token.text === '{') return false
      else if (token.text === '}') return false
      else if (depth === 0) {
        if (token.kind === 'keyword' && token.text === 'in') return true
        const allowed =
          token.kind === 'identifier' ||
          token.text === ',' ||
          token.text === ':' ||
          token.text === '->' ||
          (token.kind === 'keyword' && (token.text === 'inout' || token.text === 'self'))
        if (!allowed) return false
      }
      i++
    }
    return false
  }

  // ------------------------------------------------------------------- types

  private parseType(): TypeRef {
    const start = this.current
    let type = this.parseBaseType()

    for (;;) {
      // Optionals bind tightly and carry no whitespace: `Int?`, `String!`.
      if (this.current.kind === 'operator' && !this.current.spaceBefore) {
        if (this.current.text === '?') {
          this.advance()
          type = { kind: 'optionalType', span: this.spanFrom(start), wrapped: type, implicitlyUnwrapped: false }
          continue
        }
        if (this.current.text === '!') {
          this.advance()
          type = { kind: 'optionalType', span: this.spanFrom(start), wrapped: type, implicitlyUnwrapped: true }
          continue
        }
      }
      // Nested type: `Foo.Bar`.
      if (this.check('.') && this.peek().kind === 'identifier') {
        this.advance()
        const member = this.advance()
        type = {
          kind: 'namedType',
          span: this.spanFrom(start),
          name: `${typeName(type)}.${member.text}`,
          generics: [],
        }
        continue
      }
      return type
    }
  }

  private parseBaseType(): TypeRef {
    const start = this.current

    if (this.checkKeyword('some') || this.checkKeyword('any')) {
      this.advance()
      const constraint = this.parseBaseType()
      return { kind: 'someType', span: this.spanFrom(start), constraint }
    }

    if (this.check('[')) {
      this.advance()
      const element = this.parseType()
      if (this.match(':')) {
        const value = this.parseType()
        this.expect(']', 'to close a dictionary type')
        return { kind: 'dictionaryType', span: this.spanFrom(start), key: element, value }
      }
      this.expect(']', 'to close an array type')
      return { kind: 'arrayType', span: this.spanFrom(start), element }
    }

    if (this.check('(')) {
      this.advance()
      const elements: TypeRef[] = []
      while (!this.atEnd && !this.check(')')) {
        // Skip an argument label inside a function type.
        if (
          (this.current.kind === 'identifier' || this.current.kind === 'keyword') &&
          this.peek().text === ':' &&
          this.peek().kind === 'punctuation'
        ) {
          this.advance()
          this.advance()
        }
        elements.push(this.parseType())
        if (!this.match(',')) break
      }
      this.expect(')', 'to close a type')

      if (this.checkKeyword('async')) this.advance()
      if (this.checkKeyword('throws')) this.advance()

      if (this.match('->')) {
        const result = this.parseType()
        return { kind: 'functionType', span: this.spanFrom(start), params: elements, result }
      }
      return elements.length === 1
        ? elements[0]!
        : { kind: 'tupleType', span: this.spanFrom(start), elements }
    }

    if (this.current.kind === 'identifier' || this.current.kind === 'keyword') {
      const nameToken = this.advance()
      const generics: TypeRef[] = []

      if (this.check('<')) {
        this.advance()
        while (!this.atEnd && !this.check('>')) {
          generics.push(this.parseType())
          if (!this.match(',')) break
        }
        this.expect('>', 'to close a generic argument list')
      }

      return { kind: 'namedType', span: this.spanFrom(start), name: nameToken.text, generics }
    }

    this.error(
      this.current.span,
      'expected_token',
      `Expected a type, found ${tokenDescription(this.current)}.`,
    )
    return { kind: 'errorType', span: this.current.span }
  }
}

function typeName(type: TypeRef): string {
  switch (type.kind) {
    case 'namedType':
      return type.name
    case 'optionalType':
      return `${typeName(type.wrapped)}?`
    case 'arrayType':
      return `[${typeName(type.element)}]`
    case 'dictionaryType':
      return `[${typeName(type.key)}: ${typeName(type.value)}]`
    case 'someType':
      return `some ${typeName(type.constraint)}`
    case 'functionType':
      return `(${type.params.map(typeName).join(', ')}) -> ${typeName(type.result)}`
    case 'tupleType':
      return `(${type.elements.map(typeName).join(', ')})`
    case 'errorType':
      return '<error>'
  }
}

export { typeName }

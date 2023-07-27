# Hak to-do

* Compile-time environment should just be names (and later, types).

## Hak MVP

* REPL.
* Tail recursion elimination
* Method invocation
* Co-routines (copy Python?)
* Lists: iteration (with yield)
* Vectors
* Maps: iteration (with yield), indexing (lvalue), symbol keys
* FFI (JavaScript)
* Tree-sitter grammar, usable in Emacs and VSCode. (First, tidy up the grammar.)
* `self`
* Sort out globals access.

## HakLisp improvements

* Standalone runner.
* To optimize symbol references, add `const` (`let` but constant), and
  evaluate as much as we can at compile time. Any expression with no free
  variables can be fully evaluated.
* Make everything objects (arithmetic should be methods of `Num`).
* Compiled form has only "fresh names"; textual version has "let" as a
  convenience for readability.
* Put HakLisp AST hierarchy in another file, ditto the interpreter.
* Study vau, fexprs, first-class environments (objects), and delimited
  continuations.
* Implement new semantics in HakLisp first.
* Put tests in separate source files (but how to deal with tests that return values?).

## Hak v1

* Inter-working with C. Initial quick-and-dirty version: allow arbitrary C
  APIs to be declared (especially for POSIX; later add GLib introspection),
  and allow C bindings to be generated for Hak values that have C types, and
  any base Hack type.
* Type checking
* Structs
* Enums
* Traits (use for built-in operators)
* Classes: properties
* Tuples
* Variadic functions?
* Slices (implement on lists and strings)
* Closures: resolve symbols at compile-time, not run-time. Add to `Function`
  a closure environment, references to all its free variables.
* Match statement
* String interpolation
* Raw strings
* Long Unicode escapes
* Namespaces
* Macros: use for syntactic sugar to get e.g. "fn a () { }", and for +=
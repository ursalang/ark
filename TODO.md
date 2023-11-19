# Ark improvements

* To optimize symbol references, add `var` (mutable `let`), and
  evaluate as much as we can at compile time. Any expression with no free
  variables can be fully evaluated.
* Make everything objects (arithmetic should be methods of `Num`).
* Study vau, first-class environments (objects), and delimited
  continuations: https://github.com/catseye/Robin ; also see
  https://github.com/nukata/little-scheme-in-typescript
* Make code `readonly`. Start with `FreeVars`.
  See https://github.com/immutable-js/immutable-js/

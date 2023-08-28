import assert from 'assert'
import {CompiledArk} from './compiler'

// A Binding holds Refs to Vals, so that the Vals can potentially be updated
// while being be referred to in multiple Bindings, in particular by
// closures' free variables.
export type Binding = Map<string, Ref>

export class Stack {
  public env: Binding[]

  constructor(outerEnv: Binding[]) {
    this.env = outerEnv
  }

  get(sym: string) {
    const index = this.getIndex(sym)
    assert(index !== undefined, `get undefined symbol at run-time ${sym}`)
    return this.env[index].get(sym)!
  }

  set(sym: string, val: Val) {
    const index = this.getIndex(sym)
    assert(index !== undefined, `set undefined symbol at run-time ${sym}`)
    const ref = this.env[index].get(sym)!
    ref.set(this, val)
  }

  getIndex(sym: string) {
    for (let i = 0; i < this.env.length; i += 1) {
      if (this.env[i].has(sym)) {
        return i
      }
    }
    return undefined
  }

  extend(binding: Binding): Stack {
    return new Stack([binding, ...this.env])
  }
}

// Base class for compiled code.
export class Val {
  // Uncomment the following for debug.
  // static counter = 0

  // _uid: number

  // constructor() {
  //   super()
  //   this._uid = Val.counter
  //   Val.counter += 1
  // }
}

class ConcreteVal extends Val {
  constructor(public val: any = null) {
    super()
  }
}

export class Null extends ConcreteVal {
  constructor() {
    super(null)
  }
}

export class Bool extends ConcreteVal {
  constructor(public val: boolean) {
    super(val)
  }
}

export class Num extends ConcreteVal {
  constructor(public val: number) {
    super(val)
  }
}

export class Str extends ConcreteVal {
  constructor(public val: string) {
    super(val)
  }
}

export class HakException extends Error {
  constructor(protected val: Val = new Null()) {
    super()
  }

  value(): Val {
    return this.val
  }
}

export class BreakException extends HakException {}

export class ReturnException extends HakException {}

export class ContinueException extends HakException {}

export class PropertyException extends Error {}

export function bindArgsToParams(params: string[], args: Val[]): Binding {
  const binding = new Map(params.map((key, index) => [key, new Ref(args[index] ?? new Null())]))
  if (args.length > params.length) {
    binding.set('...', new Ref(new List(args.slice(params.length))))
  }
  return binding
}

class FexprClosure extends Val {
  constructor(protected params: string[], protected freeVars: Binding, protected body: Val) {
    super()
  }

  call(env: Stack, args: Val[]) {
    let res: Val = new Null()
    try {
      const binding = bindArgsToParams(this.params, args)
      res = evalArk(this.body, env.extend(this.freeVars).extend(binding))
    } catch (e) {
      if (!(e instanceof ReturnException)) {
        throw e
      }
      res = e.value()
    }
    return res
  }
}

class FnClosure extends FexprClosure {
  call(env: Stack, args: Val[]) {
    const evaluatedArgs = evaluateArgs(env, args)
    return super.call(env, evaluatedArgs)
  }
}

export class Fexpr extends Val {
  constructor(public params: string[], protected freeVars: Set<string>, public body: Val) {
    super()
  }

  bindFreeVars(stack: Stack): Binding {
    return new Map(
      [...this.freeVars].map((name): [string, Ref] => [name, stack.get(name)]),
    )
  }
}

export class NativeFexpr extends Val {
  constructor(
    public name: string,
    protected body: (env: Stack, ...args: Val[]) => Val,
  ) {
    super()
  }

  call(stack: Stack, args: Val[]) {
    return this.body(stack, ...args)
  }
}

function evaluateArgs(stack: Stack, args: Val[]) {
  const evaluatedArgs: Val[] = []
  for (const arg of args) {
    evaluatedArgs.push(evalArk(arg, stack))
  }
  return evaluatedArgs
}

export class Fn extends Fexpr {}

class NativeFn extends Val {
  constructor(
    public name: string,
    protected body: (...args: Val[]) => Val,
  ) {
    super()
  }

  call(stack: Stack, args: Val[]) {
    return this.body(...evaluateArgs(stack, args))
  }
}

export class Ref extends Val {
  constructor(public val: Val = new Null()) {
    super()
  }

  set(_stack: Stack, val: Val) {
    this.val = val
    return val
  }
}

export class SymRef extends Ref {
  constructor(public name: string) {
    super()
  }

  set(stack: Stack, val: Val) {
    const evaluatedVal = evalArk(val, stack)
    stack.set(this.name, evaluatedVal)
    return evaluatedVal
  }
}

export class Obj extends Val {
  constructor(jsObj: Object) {
    super()
    for (const key in jsObj) {
      if (Object.hasOwn(jsObj, key)) {
        (this as any)[key] = (jsObj as any)[key]
      }
    }
  }
}

// Until we can evaluate a dict literal, we don't know the values of its
// keys.
export class DictLiteral extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }
}

export class Dict extends Val {
  constructor(public map: Map<Val, Val>) {
    super()
  }

  set(_stack: Stack, index: Val, val: Val) {
    this.map.set(toJs(index), val)
    return val
  }

  get(_stack: Stack, index: Val) {
    return this.map.get(toJs(index)) ?? new Null()
  }
}

export class List extends Val {
  constructor(public val: Val[]) {
    super()
  }

  length(_stack: Stack) {
    return new Num(this.val.length)
  }

  get(_stack: Stack, index: Val) {
    return this.val[toJs(index as Num)]
  }

  set(_stack: Stack, index: Val, val: Val) {
    this.val[toJs(index)] = val
    return val
  }
}

export class Let extends Val {
  constructor(public boundVars: string[], public body: Val) {
    super()
  }
}

export class Call extends Val {
  constructor(public fn: Val, public args: Val[]) {
    super()
  }
}

export class Prop extends Val {
  constructor(public prop: string, public ref: Val, public args: Val[]) {
    super()
  }
}

function jsToVal(x: any): Val {
  if (x === null || x === undefined) {
    return new Null()
  }
  if (typeof x === 'boolean') {
    return new Bool(x)
  }
  if (typeof x === 'number') {
    return new Num(x)
  }
  if (typeof x === 'string') {
    return new Str(x)
  }
  if (typeof x === 'function') {
    return new NativeFn(x.name, (...args: Val[]) => jsToVal(x(...args.map(toJs))))
  }
  if (typeof x === 'object') {
    return new Obj(x)
  }
  throw new Error(`cannot convert JavaScript value ${x}`)
}

export const intrinsics: {[key: string]: Val} = {
  new: new NativeFn('new', (val: Val) => new Ref(val)),
  pos: new NativeFn('pos', (val: Val) => new Num(+toJs(val))),
  neg: new NativeFn('neg', (val: Val) => new Num(-toJs(val))),
  not: new NativeFn('not', (val: Val) => new Bool(!toJs(val))),
  seq: new NativeFexpr('seq', (stack: Stack, ...args: Val[]) => {
    let res: Val = new Null()
    for (const exp of args) {
      res = evalArk(exp, stack)
    }
    return res
  }),
  if: new NativeFexpr('if', (stack: Stack, cond: Val, e_then: Val, e_else: Val) => {
    const condVal = evalArk(cond, stack)
    if (toJs(condVal)) {
      return evalArk(e_then, stack)
    }
    return e_else ? evalArk(e_else, stack) : new Null()
  }),
  and: new NativeFexpr('and', (stack: Stack, left: Val, right: Val) => {
    const leftVal = evalArk(left, stack)
    if (toJs(leftVal)) {
      return evalArk(right, stack)
    }
    return leftVal
  }),
  or: new NativeFexpr('or', (stack: Stack, left: Val, right: Val) => {
    const leftVal = evalArk(left, stack)
    if (toJs(leftVal)) {
      return leftVal
    }
    return evalArk(right, stack)
  }),
  loop: new NativeFexpr('loop', (stack: Stack, body: Val) => {
    for (; ;) {
      try {
        evalArk(body, stack)
      } catch (e) {
        if (e instanceof BreakException) {
          return e.value()
        }
        if (!(e instanceof ContinueException)) {
          throw e
        }
      }
    }
  }),
  break: new NativeFn('break', (val: Val) => {
    throw new BreakException(val)
  }),
  continue: new NativeFn('continue', () => {
    throw new ContinueException()
  }),
  return: new NativeFn('return', (val: Val) => {
    throw new ReturnException(val)
  }),
  '=': new NativeFn('=', (left: Val, right: Val) => new Bool(toJs(left) === toJs(right))),
  '!=': new NativeFn('!=', (left: Val, right: Val) => new Bool(toJs(left) !== toJs(right))),
  '<': new NativeFn('<', (left: Val, right: Val) => new Bool(toJs(left) < toJs(right))),
  '<=': new NativeFn('<=', (left: Val, right: Val) => new Bool(toJs(left) <= toJs(right))),
  '>': new NativeFn('>', (left: Val, right: Val) => new Bool(toJs(left) > toJs(right))),
  '>=': new NativeFn('>=', (left: Val, right: Val) => new Bool(toJs(left) >= toJs(right))),
  '+': new NativeFn('+', (left: Val, right: Val) => new Num(toJs(left) + toJs(right))),
  '-': new NativeFn('-', (left: Val, right: Val) => new Num(toJs(left) - toJs(right))),
  '*': new NativeFn('*', (left: Val, right: Val) => new Num(toJs(left) * toJs(right))),
  '/': new NativeFn('/', (left: Val, right: Val) => new Num(toJs(left) / toJs(right))),
  '%': new NativeFn('%', (left: Val, right: Val) => new Num(toJs(left) % toJs(right))),
  '**': new NativeFn('**', (left: Val, right: Val) => new Num(toJs(left) ** toJs(right))),
}

export const globals: Binding = new Map([
  ['pi', new Ref(new Num(Math.PI))],
  ['e', new Ref(new Num(Math.E))],
  ['print', new Ref(new NativeFn('print', (obj: Val) => {
    console.log(toJs(obj))
    return new Null()
  }))],
  ['debug', new Ref(new NativeFn('debug', (obj: Val) => {
    debug(obj)
    return new Null()
  }))],
  ['js', new Ref(new Obj({
    use: (_stack: Stack, ...args: Val[]) => {
      const requirePath = (args.map(toJs).join('.'))
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const module = require(requirePath)
      const wrappedModule = {}
      // eslint-disable-next-line guard-for-in
      for (const key in module) {
        (wrappedModule as any)[key] = () => jsToVal(module[key])
      }
      return new Obj(wrappedModule)
    },
  }))],
])

export function evalArk(val: Val, stack: Stack): Val {
  if (val instanceof SymRef) {
    const ref = stack.get(val.name)
    return evalArk(ref, stack)
  } else if (val instanceof Ref) {
    return val.val
  } else if (val instanceof Fn) {
    return new FnClosure(val.params, val.bindFreeVars(stack), val.body)
  } else if (val instanceof Fexpr) {
    return new FexprClosure(val.params, val.bindFreeVars(stack), val.body)
  } else if (val instanceof DictLiteral) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(toJs(evalArk(k, stack)), evalArk(v, stack))
    }
    return new Dict(evaluatedMap)
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, evalArk(v, stack) as Val)
    }
    // FIXME: Don't do this: need to be able to use ConcreteVal values as
    // keys by their underlying value.
    // eslint-disable-next-line no-param-reassign
    val.map = evaluatedMap
    return val
  } else if (val instanceof List) {
    // eslint-disable-next-line no-param-reassign
    val.val = val.val.map((e) => evalArk(e, stack))
    return val
  } else if (val instanceof Let) {
    const binding = bindArgsToParams(val.boundVars, [])
    binding.forEach((v) => {
      // First eval the Ref, then eval the value
      v.set(stack, evalArk(evalArk(v, stack), stack))
    })
    return evalArk(val.body, stack.extend(binding))
  } else if (val instanceof Call) {
    const fn = evalArk(val.fn, stack) as FexprClosure
    return fn.call(stack, val.args)
  } else if (val instanceof Prop) {
    const obj = evalArk(val.ref, stack)
    if (!(val.prop in obj)) {
      throw new PropertyException(`no property '${val.prop}'`)
    }
    return (obj as any)[val.prop](stack, ...val.args.map((e) => evalArk(e, stack)))
  }
  return val
}

function subsetOf<T>(setA: Set<T>, setB: Set<T>): boolean {
  for (const elem of setA) {
    if (!setB.has(elem)) {
      return false
    }
  }
  return true
}

export function runArk(
  compiledVal: CompiledArk,
  stack: Stack = new Stack([]),
): Val {
  const envWithGlobals = stack.extend(globals)
  const envVars = new Set(envWithGlobals.env.flatMap((binding) => [...binding.keys()]))
  assert(subsetOf(compiledVal[1], envVars))
  return evalArk(compiledVal[0], envWithGlobals)
}

export function toJs(val: Val): any {
  if (val instanceof ConcreteVal) {
    return val.val
  } else if (val instanceof Obj) {
    const obj = {}
    // eslint-disable-next-line guard-for-in
    for (const key in val) {
      (obj as any)[key] = toJs((val as any)[key] as Val)
    }
    return obj
  } else if (val instanceof DictLiteral) {
    // Best effort.
    return toJs(evalArk(val, new Stack([])))
  } else if (val instanceof Dict) {
    const evaluatedMap = new Map<any, Val>()
    for (const [k, v] of val.map) {
      evaluatedMap.set(k, toJs(evalArk(v, new Stack([]))))
    }
    return evaluatedMap
  } else if (val instanceof List) {
    return val.val.map(toJs)
  }
  return val
}

export function serialize(val: Val) {
  function doSerialize(val: Val): any {
    if (val instanceof SymRef || val instanceof NativeFexpr) {
      return val.name
    } else if (val instanceof Str) {
      return ['str', val.val]
    } else if (val instanceof ConcreteVal) {
      return val.val
    } else if (val instanceof Ref) {
      return ['ref', doSerialize(val.val)]
    } else if (val instanceof Fn) {
      return ['fn', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Fexpr) {
      return ['fexpr', ['params', ...val.params], doSerialize(val.body)]
    } else if (val instanceof Obj) {
      const obj = {}
      // eslint-disable-next-line guard-for-in
      for (const key in val) {
        (obj as any)[key] = doSerialize((val as any)[key] as Val)
      }
      return obj
    } else if (val instanceof DictLiteral) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        obj.push([doSerialize(k), doSerialize(v)])
      }
      return obj
    } else if (val instanceof Dict) {
      const obj: any[] = ['map']
      for (const [k, v] of val.map) {
        // FIXME: see evalArk.
        const keyJs = k instanceof Val ? doSerialize(k) : k
        obj.push([keyJs, doSerialize(v)])
      }
      return obj
    } else if (val instanceof List) {
      return ['list', ...val.val.map(doSerialize)]
    } else if (val instanceof Let) {
      return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
    } else if (val instanceof Call) {
      return [doSerialize(val.fn), ...val.args.map(doSerialize)]
    } else if (val instanceof Prop) {
      return ['prop', val.prop, doSerialize(val.ref), ...val.args.map(doSerialize)]
    }
    return val
  }

  return JSON.stringify(doSerialize(val))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth, colors: true})
}

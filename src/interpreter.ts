// Ark interpreter.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import fs from 'fs'
import assert from 'assert'

import {CompiledArk, Namespace} from './parser.js'
import {ArkFromJsError, fromJs, toJs} from './ffi.js'

// Each stack frame consists of a pair of local vars and captures, plus
// debug info.
type ArkFrame = [ArkRef[], ArkRef[], Map<string, any>]

export class RuntimeStack {
  constructor(public readonly stack: ArkFrame[] = [[[], [], new Map()]]) {
    assert(stack.length > 0)
  }

  push(items: ArkRef[]) {
    this.stack[0][0].push(...items)
    return this
  }

  pop(nItems: number) {
    for (let i = 0; i < nItems; i += 1) {
      this.stack[0][0].pop()
    }
  }

  pushFrame(frame: ArkFrame) {
    this.stack.unshift(frame)
    return this
  }

  popFrame() {
    this.stack.shift()
    return this
  }
}

export type FreeVarsMap = Map<string, ArkStackRef[]>

export class ArkState {
  readonly stack = new RuntimeStack()

  debug: Map<string, any> = new Map()

  run(compiledVal: CompiledArk): ArkVal {
    if (compiledVal.freeVars.size !== 0) {
      throw new ArkRuntimeError(
        `Undefined symbols ${[...compiledVal.freeVars.keys()].join(', ')}`,
        compiledVal.value,
      )
    }
    return compiledVal.value.eval(this)
  }
}

export class ArkRuntimeError extends Error {
  sourceLoc: any

  constructor(public message: string, public val: ArkVal) {
    super()
    this.sourceLoc = val.debug.get('sourceLoc')
  }
}

// Base class for compiled code.
export class Ark {
  static nextId = 0

  constructor() {
    this.debug.set('uid', Ark.nextId)
    Ark.nextId += 1
  }

  debug: Map<string, any> = new Map()
}

export class ArkVal extends Ark {}

export class ArkExp extends Ark {
  // Make this class incompatible with ArkVal.
  _arkexp: undefined

  eval(_ark: ArkState): ArkVal {
    return this
  }
}

export class ArkLiteral extends ArkExp {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }

  eval(_ark: ArkState): ArkVal {
    return this.val
  }
}

export class ArkConcreteVal<T> extends ArkVal {
  constructor(public val: T) {
    super()
  }
}

class ConcreteInterned {
  constructor() {
    throw new Error('use ConcreteInterned.create, not constructor')
  }

  private static intern: Map<any, WeakRef<ArkConcreteVal<any>>> = new Map()

  private static registry: FinalizationRegistry<any> = new FinalizationRegistry(
    (key) => this.intern.delete(key),
  )

  static value<T>(rawVal: T): ArkConcreteVal<T> {
    let ref = ConcreteInterned.intern.get(rawVal)
    let val: ArkConcreteVal<T>
    if (ref === undefined || ref.deref() === undefined) {
      val = new ArkConcreteVal(rawVal)
      ref = new WeakRef(val)
      ConcreteInterned.intern.set(rawVal, ref)
      ConcreteInterned.registry.register(val, rawVal, val)
    } else {
      val = ref.deref()!
    }
    return val
  }
}

export const ArkUndefined = new ArkVal()
ArkUndefined.debug.set('name', 'Undefined')
export const ArkNull = () => ConcreteInterned.value(null)
export const ArkBoolean = (b: boolean) => ConcreteInterned.value(b)
export const ArkNumber = (n: number) => ConcreteInterned.value(n)
export const ArkString = (s: string) => ConcreteInterned.value(s)

export class ArkNonLocalReturn extends Error {
  constructor(public readonly val: ArkVal = ArkNull()) {
    super()
  }
}

export class ArkBreakException extends ArkNonLocalReturn {}

export class ArkReturnException extends ArkNonLocalReturn {}

export class ArkContinueException extends ArkNonLocalReturn {}

function bindArgsToParams(params: string[], args: ArkVal[]): ArkRef[] {
  const frame: ArkValRef[] = params.map(
    (_key, index) => new ArkValRef(args[index] ?? ArkUndefined),
  )
  if (args.length > params.length) {
    // FIXME: Support '...' as an identifier
    frame.push(new ArkValRef(new ArkList(args.slice(params.length))))
  }
  return frame
}

class ArkClosure extends ArkExp {
  constructor(public params: string[], public freeVars: ArkRef[], public body: ArkExp) {
    super()
  }
}

export class ArkFn extends ArkExp {
  constructor(public params: string[], public boundFreeVars: ArkStackRef[], public body: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const freeVarsFrame: ArkRef[] = []
    for (const loc of this.boundFreeVars) {
      const ref = ark.stack.stack[loc.level - 1][0][loc.index]
      freeVarsFrame.push(ref)
    }
    return new ArkClosure(this.params, freeVarsFrame, this.body)
  }
}

export class NativeFn extends ArkExp {
  constructor(public body: (ark: ArkState, ...args: ArkVal[]) => ArkVal) {
    super()
  }
}

export class ArkCall extends ArkExp {
  constructor(public fn: ArkExp, public args: ArkExp[]) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const fn = this.fn
    let sym: ArkRef | undefined
    if (fn instanceof ArkGet && fn.val instanceof ArkLiteral && fn.val.val instanceof ArkRef) {
      sym = fn.val.val
    }
    const fnVal = fn.eval(ark)
    if (!(fnVal instanceof ArkClosure || fnVal instanceof NativeFn)) {
      throw new ArkRuntimeError('Invalid call', this)
    }
    const evaluatedArgs = []
    for (const arg of this.args) {
      evaluatedArgs.push(arg.eval(ark))
    }
    let res: ArkVal = ArkNull()
    if (fnVal instanceof NativeFn) {
      res = fnVal.body(ark, ...evaluatedArgs)
    } else {
      try {
        const frame = bindArgsToParams(fnVal.params, evaluatedArgs)
        ark.stack.pushFrame([
          frame,
          fnVal.freeVars,
          new Map<string, any>([['source', this], ['name', sym]]),
        ])
        res = fnVal.body.eval(ark)
        ark.stack.popFrame()
      } catch (e) {
        if (!(e instanceof ArkReturnException)) {
          throw e
        }
        res = e.val
      }
    }
    return res
  }
}

export abstract class ArkRef extends ArkVal {
  abstract get(stack: RuntimeStack): ArkVal

  abstract set(stack: RuntimeStack, val: ArkVal): ArkVal
}

export class ArkValRef extends ArkRef {
  constructor(public val: ArkVal = ArkNull()) {
    super()
  }

  get(_stack: RuntimeStack): ArkVal {
    return this.val
  }

  set(_stack: RuntimeStack, val: ArkVal): ArkVal {
    this.val = val
    return val
  }
}

export class ArkStackRef extends ArkRef {
  constructor(public level: number, public index: number) {
    super()
  }

  get(stack: RuntimeStack): ArkVal {
    return stack.stack[this.level][0][this.index].get(stack)
  }

  set(stack: RuntimeStack, val: ArkVal) {
    stack.stack[this.level][0][this.index].set(stack, val)
    return val
  }
}

export class ArkCaptureRef extends ArkRef {
  constructor(public index: number) {
    super()
  }

  get(stack: RuntimeStack): ArkVal {
    return stack.stack[0][1][this.index].get(stack)
  }

  set(stack: RuntimeStack, val: ArkVal) {
    const ref = stack.stack[0][1][this.index]
    ref.set(stack, val)
    return val
  }
}

export class ArkGet extends ArkExp {
  constructor(public val: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const ref = (this.val.eval(ark) as ArkRef)
    const val = ref.get(ark.stack)
    if (val === ArkUndefined) {
      throw new ArkRuntimeError(`Uninitialized symbol ${this.val.debug.get('name')}`, this)
    }
    return val
  }
}

export class ArkSet extends ArkExp {
  constructor(public ref: ArkExp, public val: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const ref = this.ref.eval(ark)
    const res = this.val.eval(ark)
    if (!(ref instanceof ArkRef)) {
      throw new ArkRuntimeError('Invalid assignment', this)
    }
    ref.set(ark.stack, res)
    return res
  }
}

export class ArkClass extends ArkVal {
  public val: Map<string, ArkVal>

  constructor(obj: Map<string, ArkVal>) {
    super()
    this.val = obj
  }

  get(prop: string): ArkVal | undefined {
    return this.val.get(prop)
  }

  set(prop: string, val: ArkVal) {
    this.val.set(prop, val)
    return val
  }
}

export class ArkObject extends ArkClass {}

export class ArkObjectLiteral extends ArkExp {
  constructor(public val: Map<string, ArkExp>) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const inits = new Map<string, ArkVal>()
    for (const [k, v] of this.val) {
      inits.set(k, v.eval(ark))
    }
    return new ArkObject(inits)
  }
}

export class NativeObject extends ArkVal {
  constructor(public obj: Object) {
    super()
  }

  get(prop: string): ArkVal | undefined {
    try {
      return fromJs((this.obj as any)[prop], this.obj)
    } catch (e) {
      if (e instanceof ArkFromJsError) {
        throw new ArkRuntimeError(e.message, this)
      }
      throw e
    }
  }

  set(prop: string, val: ArkVal) {
    (this.obj as any)[prop] = toJs(val)
    return val
  }
}

export class ArkProperty extends ArkExp {
  constructor(public prop: string, public obj: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const obj = this.obj.eval(ark)
    return new ArkPropertyRef(obj as ArkObject, this.prop)
  }
}

export class ArkPropertyRef extends ArkRef {
  constructor(public obj: ArkObject, public prop: string) {
    super()
  }

  get(_stack: RuntimeStack) {
    return this.obj.get(this.prop) ?? ArkNull()
  }

  set(_stack: RuntimeStack, val: ArkVal) {
    this.obj.set(this.prop, val)
    return val
  }
}

export class ArkMap extends ArkClass {
  constructor(public map: Map<ArkVal, ArkVal>) {
    super(new Map([
      ['set', new NativeFn(
        (_ark: ArkState, index: ArkVal, val: ArkVal) => {
          this.map.set(index, val)
          return val
        },
      )],
      ['get', new NativeFn((_ark: ArkState, index: ArkVal) => this.map.get(index) ?? ArkNull())],
    ]))
  }
}

export class ArkMapLiteral extends ArkExp {
  constructor(public map: Map<ArkExp, ArkExp>) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const evaluatedMap = new Map<any, ArkVal>()
    for (const [k, v] of this.map) {
      evaluatedMap.set(k.eval(ark), v.eval(ark))
    }
    return new ArkMap(evaluatedMap)
  }
}

export class ArkList extends ArkClass {
  constructor(public list: ArkVal[]) {
    super(new Map([
      ['get', new NativeFn((_ark: ArkState, index: ArkVal) => this.list[toJs(index)])],
      ['set', new NativeFn(
        (_ark: ArkState, index: ArkVal, val: ArkVal) => {
          this.list[toJs(index)] = val
          return val
        },
      )],
    ]))
    this.val.set('length', ArkNumber(this.list.length))
  }
}

export class ArkListLiteral extends ArkExp {
  constructor(public list: ArkExp[]) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    return new ArkList(this.list.map((e) => e.eval(ark)))
  }
}

export class ArkLet extends ArkExp {
  constructor(public boundVars: string[], public body: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const lets = bindArgsToParams(this.boundVars, [])
    ark.stack.push(lets)
    const res = this.body.eval(ark)
    ark.stack.pop(lets.length)
    return res
  }
}

export class ArkSequence extends ArkExp {
  constructor(public exps: ArkExp[]) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    let res: ArkVal = ArkNull()
    for (const exp of this.exps) {
      res = exp.eval(ark)
    }
    return res
  }
}

export class ArkIf extends ArkExp {
  constructor(public cond: ArkExp, public thenExp: ArkExp, public elseExp?: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const condVal = this.cond.eval(ark)
    if (toJs(condVal)) {
      return this.thenExp.eval(ark)
    }
    return this.elseExp ? this.elseExp.eval(ark) : ArkNull()
  }
}

export class ArkAnd extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const leftVal = this.left.eval(ark)
    if (toJs(leftVal)) {
      return this.right.eval(ark)
    }
    return leftVal
  }
}

export class ArkOr extends ArkExp {
  constructor(public left: ArkExp, public right: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    const leftVal = this.left.eval(ark)
    if (toJs(leftVal)) {
      return leftVal
    }
    return this.right.eval(ark)
  }
}

export class ArkLoop extends ArkExp {
  constructor(public body: ArkExp) {
    super()
  }

  eval(ark: ArkState): ArkVal {
    for (; ;) {
      try {
        this.body.eval(ark)
      } catch (e) {
        if (e instanceof ArkBreakException) {
          return e.val
        }
        if (!(e instanceof ArkContinueException)) {
          throw e
        }
      }
    }
  }
}

export const intrinsics = new Map([
  ['pos', new NativeFn((_ark: ArkState, val: ArkVal) => ArkNumber(+toJs(val)))],
  ['neg', new NativeFn((_ark: ArkState, val: ArkVal) => ArkNumber(-toJs(val)))],
  ['not', new NativeFn((_ark: ArkState, val: ArkVal) => ArkBoolean(!toJs(val)))],
  ['~', new NativeFn((_ark: ArkState, val: ArkVal) => ArkNumber(~toJs(val)))],
  ['break', new NativeFn((_ark: ArkState, val: ArkVal) => {
    throw new ArkBreakException(val)
  })],
  ['continue', new NativeFn(() => {
    throw new ArkContinueException()
  })],
  ['return', new NativeFn((_ark: ArkState, val: ArkVal) => {
    throw new ArkReturnException(val)
  })],
  ['=', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) === toJs(right)))],
  ['!=', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) !== toJs(right)))],
  ['<', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) < toJs(right)))],
  ['<=', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) <= toJs(right)))],
  ['>', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) > toJs(right)))],
  ['>=', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkBoolean(toJs(left) >= toJs(right)))],
  ['+', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) + toJs(right)))],
  ['-', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) - toJs(right)))],
  ['*', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) * toJs(right)))],
  ['/', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) / toJs(right)))],
  ['%', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) % toJs(right)))],
  ['**', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) ** toJs(right)))],
  ['&', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) & toJs(right)))],
  ['|', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) | toJs(right)))],
  ['^', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) ^ toJs(right)))],
  ['<<', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) << toJs(right)))],
  ['>>', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) >> toJs(right)))],
  ['>>>', new NativeFn((_ark: ArkState, left: ArkVal, right: ArkVal) => ArkNumber(toJs(left) >>> toJs(right)))],
])

export const globals = new Namespace([
  ['pi', new ArkValRef(ArkNumber(Math.PI))],
  ['e', new ArkValRef(ArkNumber(Math.E))],
  ['print', new ArkValRef(new NativeFn((_ark: ArkState, obj: ArkVal) => {
    console.log(toJs(obj))
    return ArkNull()
  }))],
  ['debug', new ArkValRef(new NativeFn((_ark: ArkState, obj: ArkVal) => {
    debug(obj)
    return ArkNull()
  }))],
  ['fs', new ArkValRef(new NativeObject(fs))],
  // ['js', new ValRef(new Obj(new Map([[
  //   'use', new NativeFn('js', async (_ark: ArkState, ...args: Val[]) => {
  //     const importPath = (args.map(toJs).join('.'))
  //     const module = await import(requirePath)
  //     const wrappedModule = new Map()
  //     // eslint-disable-next-line guard-for-in
  //     for (const key in module) {
  //       wrappedModule.set(key, jsToVal(module[key]))
  //     }
  //     return new Obj(wrappedModule)
  //   }),
  // ]])))],
  ['JSON', new ArkValRef(new NativeObject(JSON))],
  ['process', new ArkValRef(new NativeObject(process))],
  ['RegExp', new ArkValRef(new NativeFn((_ark: ArkState, regex: ArkVal, options: ArkVal) => new NativeObject(new RegExp(
    (regex as ArkConcreteVal<string>).val,
    ((options ?? ArkString('')) as ArkConcreteVal<string>).val,
  )))),
  ],
])
if (globalThis.document !== undefined) {
  globals.set('document', new ArkValRef(new NativeObject(globalThis.document)))
}

export function debug(x: any, depth: number | null = 1) {
  console.dir(x, {depth, colors: true})
}

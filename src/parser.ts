// Parse JSON into Ark code.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'assert'

import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug,
  ArkVal, ArkExp, intrinsics, globals, FreeVarsMap,
  ArkIf, ArkAnd, ArkOr, ArkSequence, ArkLoop,
  ArkConcreteVal, ArkNull, ArkBoolean, ArkNumber, ArkString,
  ArkGet, ArkSet, ArkRef, ArkValRef, ArkStackRef, ArkCaptureRef,
  ArkListLiteral, ArkObjectLiteral, ArkMapLiteral,
  ArkFn, ArkProperty, ArkLet, ArkCall,
} from './interpreter.js'

export class ArkCompilerError extends Error {}

export class Namespace extends Map<string, ArkExp> {
  constructor(inits: [string, ArkExp][]) {
    super(inits)
    for (const [name, val] of inits) {
      Namespace.setName(name, val)
    }
  }

  private static setName(name: string, val: ArkVal) {
    if (!(val instanceof ArkConcreteVal)) {
      val.debug.set('name', name)
    }
  }

  set(name: string, val: ArkExp) {
    Namespace.setName(name, val)
    super.set(name, val)
    return this
  }
}

export class FreeVars extends Map<string, ArkStackRef[]> {
  merge(moreVars: FreeVarsMap): FreeVars {
    for (const [name, symrefs] of moreVars) {
      if (!this.has(name)) {
        this.set(name, [])
      }
      this.get(name)!.push(...symrefs)
    }
    return this
  }
}

export class Environment {
  // Each stack frame consists of a pair of local vars and captures
  constructor(
    public stack: [string[], string[]][] = [[[], []]],
    public externalSyms: Namespace = globals,
  ) {
    assert(stack.length > 0)
  }

  push(items: string[]) {
    return new (this.constructor as any)(
      [[[...this.stack[0][0].slice(), ...items], this.stack[0][1]], ...this.stack.slice(1)],
    )
  }

  pushFrame(frame: [string[], string[]]) {
    return new (this.constructor as any)([frame, ...this.stack.slice()])
  }

  getIndex(sym: string): ArkRef {
    let ref
    for (let i = 0; i < this.stack.length; i += 1) {
      const j = this.stack[i][0].lastIndexOf(sym)
      if (j !== -1) {
        ref = new ArkStackRef(i, j)
        break
      }
    }
    if (ref === undefined) {
      if (this.externalSyms.has(sym)) {
        ref = this.externalSyms.get(sym) as ArkValRef
      } else {
        throw new ArkCompilerError(`Undefined symbol ${sym}`)
      }
    }
    ref.debug.set('name', sym)
    ref.debug.set('env', JSON.stringify(this))
    return ref
  }
}

export function checkParamList(params: string[]): string[] {
  if (new Set(params).size !== params.length) {
    throw new ArkCompilerError('Duplicate parameters in list')
  }
  return params
}

export function arkParamList(params: any[]): string[] {
  if (params.length === 0 || params[0] !== 'params') {
    throw new ArkCompilerError('Invalid parameter list')
  }
  const paramList = params.slice(1)
  for (const param of paramList) {
    if (typeof param !== 'string') {
      throw new ArkCompilerError('Bad type in list')
    }
  }
  return checkParamList(paramList)
}

function listToVals(env: Environment, l: any[]): [ArkExp[], FreeVars] {
  const vals = []
  const freeVars = new FreeVars()
  for (const v of l) {
    const compiled = doCompile(v, env)
    vals.push(compiled.value)
    freeVars.merge(compiled.freeVars)
  }
  return [vals, freeVars]
}

export function symRef(env: Environment, name: string): CompiledArk {
  const val = intrinsics.get(name)
  if (val !== undefined) {
    return new CompiledArk(val)
  }
  let ref = env.getIndex(name)
  const freeVars = new FreeVars(ref instanceof ArkStackRef ? [[name, [ref]]] : [])
  const i = env.stack[0][1].lastIndexOf(name)
  if (i !== -1) {
    ref = new ArkCaptureRef(i)
  }
  if (ref instanceof ArkStackRef && ref.level > 0) {
    // Reference to outer stack level: capture it.
    const k = env.stack[0][1].length
    ref = new ArkCaptureRef(k)
    env.stack[0][1].push(name)
  }
  return new CompiledArk(ref, freeVars)
}

export class CompiledArk {
  constructor(public value: ArkExp, public freeVars: FreeVarsMap = new Map()) {}
}

export class PartialCompiledArk extends CompiledArk {
  constructor(
    public value: ArkExp,
    public freeVars: FreeVarsMap = new Map(),
    public boundVars: string[] = [],
  ) {
    super(value, freeVars)
  }
}

// FIXME: Swap argument order.
function doCompile(value: any, env: Environment): CompiledArk {
  if (value === null) {
    return new CompiledArk(ArkNull())
  }
  if (typeof value === 'boolean') {
    return new CompiledArk(ArkBoolean(value))
  }
  if (typeof value === 'number') {
    return new CompiledArk(ArkNumber(value))
  }
  if (typeof value === 'string') {
    return symRef(env, value)
  }
  if (value instanceof Array) {
    if (value.length > 0) {
      switch (value[0]) {
        case 'str':
          if (value.length !== 2 || typeof value[1] !== 'string') {
            throw new ArkCompilerError(`Invalid 'str' ${value}`)
          }
          return new CompiledArk(ArkString(value[1]))
        case 'let': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'let'")
          }
          const params = arkParamList(value[1])
          const compiled = doCompile(value[2], env.push(params))
          params.forEach((p) => compiled.freeVars.delete(p))
          return new CompiledArk(new ArkLet(params, compiled.value), compiled.freeVars)
        }
        case 'fn': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'fn'")
          }
          const params = arkParamList(value[1])
          const compiled = doCompile(value[2], env.pushFrame([params, []]))
          params.forEach((p) => compiled.freeVars.delete(p))
          return new CompiledArk(
            new ArkFn(params, [...compiled.freeVars.values()].flat(), compiled.value),
            compiled.freeVars,
          )
        }
        case 'prop': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'prop'")
          }
          const compiled = doCompile(value[2], env)
          return new CompiledArk(new ArkProperty(value[1], compiled.value), compiled.freeVars)
        }
        case 'ref': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'ref'")
          }
          const compiled = doCompile(value[1], env)
          return new CompiledArk(new ArkValRef(compiled.value), compiled.freeVars)
        }
        case 'get': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'get'")
          }
          const compiled = doCompile(value[1], env)
          return new CompiledArk(new ArkGet(compiled.value), compiled.freeVars)
        }
        case 'set': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'set'")
          }
          const compiledRef = doCompile(value[1], env)
          const compiledVal = doCompile(value[2], env)
          const freeVars = new FreeVars(compiledVal.freeVars).merge(compiledRef.freeVars)
          return new CompiledArk(new ArkSet(compiledRef.value, compiledVal.value), freeVars)
        }
        case 'list': {
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return new CompiledArk(new ArkListLiteral(elems), elemsFreeVars)
        }
        case 'map': {
          const inits = new Map<ArkExp, ArkExp>()
          const initsFreeVars = new FreeVars()
          for (const pair of value.slice(1)) {
            assert(pair instanceof Array && pair.length === 2)
            const compiledKey = doCompile(pair[0], env)
            const compiledVal = doCompile(pair[1], env)
            inits.set(compiledKey.value, compiledVal.value)
            initsFreeVars.merge(compiledKey.freeVars)
            initsFreeVars.merge(compiledVal.freeVars)
          }
          return new CompiledArk(new ArkMapLiteral(inits), initsFreeVars)
        }
        case 'seq': {
          if (value.length === 2) {
            return doCompile(value[1], env)
          }
          const [elems, elemsFreeVars] = listToVals(env, value.slice(1))
          return new CompiledArk(new ArkSequence(elems), elemsFreeVars)
        }
        case 'if': {
          if (value.length < 3 || value.length > 4) {
            throw new ArkCompilerError("Invalid 'if'")
          }
          const compiledCond = doCompile(value[1], env)
          const compiledThen = doCompile(value[2], env)
          let freeVars = new FreeVars(compiledCond.freeVars).merge(compiledThen.freeVars)
          let compiledElse
          if (value.length === 4) {
            compiledElse = doCompile(value[3], env)
            freeVars = freeVars.merge(compiledElse.freeVars)
          }
          return new CompiledArk(new ArkIf(
            compiledCond.value,
            compiledThen.value,
            compiledElse ? compiledElse.value : undefined,
          ), freeVars)
        }
        case 'and': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'and'")
          }
          const compiledLeft = doCompile(value[1], env)
          const compiledRight = doCompile(value[2], env)
          const freeVars = new FreeVars(compiledLeft.freeVars).merge(compiledRight.freeVars)
          return new CompiledArk(new ArkAnd(compiledLeft.value, compiledRight.value), freeVars)
        }
        case 'or': {
          if (value.length !== 3) {
            throw new ArkCompilerError("Invalid 'or'")
          }
          const compiledLeft = doCompile(value[1], env)
          const compiledRight = doCompile(value[2], env)
          const freeVars = new FreeVars(compiledLeft.freeVars).merge(compiledRight.freeVars)
          return new CompiledArk(new ArkOr(compiledLeft.value, compiledRight.value), freeVars)
        }
        case 'loop': {
          if (value.length !== 2) {
            throw new ArkCompilerError("Invalid 'loop'")
          }
          const compiledBody = doCompile(value[1], env)
          return new CompiledArk(new ArkLoop(compiledBody.value), compiledBody.freeVars)
        }
        default: {
          const compiledFn = doCompile(value[0], env)
          const [args, argsFreeVars] = listToVals(env, value.slice(1))
          const freeVars = argsFreeVars.merge(compiledFn.freeVars)
          return new CompiledArk(new ArkCall(compiledFn.value, args), freeVars)
        }
      }
    }
  }
  if (typeof value === 'object') {
    const inits = new Map()
    const initsFreeVars = new FreeVars()
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        const compiled = doCompile(value[key], env)
        inits.set(key, compiled.value)
        initsFreeVars.merge(compiled.freeVars)
      }
    }
    return new CompiledArk(new ArkObjectLiteral(inits), initsFreeVars)
  }
  throw new ArkCompilerError(`Invalid value ${value}`)
}

export function compile(
  expr: string,
  env: Environment = new Environment(),
): CompiledArk {
  const compiled = doCompile(JSON.parse(expr), env)
  env.externalSyms.forEach((_val, id) => compiled.freeVars.delete(id))
  return compiled
}
